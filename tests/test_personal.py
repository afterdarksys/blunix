import base64
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import yaml

from blunix.errors import BlunixError
from blunix.bootstrap import ask_hostname
from blunix.node import apply_node, check_node
from blunix.personal import parse_admin, parse_packages, provision, replacement
from blunix.schema import expand_build_host
from test_installer import Rig, _node_bytes, _disk, _part, _listing, GIB, MODELS

PUBLIC_KEY = 'ssh-ed25519 ' + base64.b64encode(bytes.fromhex('0000000b7373682d6564323535313900000020') + b'x' * 32).decode()

class PersonalTests(unittest.TestCase):
    def doc(self):
        doc = yaml.safe_load(_node_bytes())
        doc.update(target='S1', install={'erase': True, 'reboot': False}, packages=['git'])
        return doc

    def test_two_inputs_and_no_confirmation_even_for_used_exact_target(self):
        for reboot in (False, True):
            doc = self.doc(); doc['install']['reboot'] = reboot
            rig = Rig(answers=['https://ada.blnx.io/'], key='personal-key', cipher=b'cipher', decrypt=lambda *_: yaml.safe_dump(doc).encode(), listing=_listing(_disk('vda', 20*GIB, children=[_part('vda1','vda')], serial='S1')))
            reads = []; hidden = []
            rig.hooks.read = lambda timeout=None: reads.append(True) or 'https://ada.blnx.io/'
            rig.hooks.read_key = lambda: hidden.append(True) or 'personal-key'
            rig.hooks.apply = lambda *_a, **_kw: None
            try:
                self.assertEqual(rig.run(), 0)
                self.assertEqual(len(reads), 1)
                self.assertEqual(len(hidden), 1)
                self.assertEqual(rig.written, ['/dev/vda'])
                self.assertEqual(rig.rebooted, [True] if reboot else [])
                self.assertNotIn('personal-key', '\n'.join(rig.said))
            finally: rig.cleanup()

    def test_unattended_rejects_missing_target_consent_and_unsupported_disk_before_writes(self):
        for override in ({'target': None}, {'install': {'erase': False, 'reboot': False}}, {'disk': 'metal-luks'}, {'target': 'absent'}):
            doc = self.doc(); doc.update(override)
            rig = Rig(answers=['ada'], key='personal-key', cipher=b'cipher', decrypt=lambda *_: yaml.safe_dump(doc).encode())
            try:
                self.assertEqual(rig.run(), 1)
                self.assertEqual(rig.written, [])
            finally: rig.cleanup()

    def test_package_failure_never_marks_bootstrap_complete(self):
        with tempfile.TemporaryDirectory() as root, patch('blunix.node.provision', side_effect=BlunixError('failed')):
            with self.assertRaises(BlunixError): apply_node(self.doc(), root, models=MODELS)
            self.assertFalse((Path(root)/'var/lib/blunix/bootstrap-complete').exists())

    def test_package_and_admin_validation(self):
        self.assertEqual(parse_packages(['git','curl']), ['curl','git'])
        for value in ('git', ['git','git'], ['--help'], ['git;id'], [3]):
            with self.assertRaises(BlunixError): parse_packages(value)
        self.assertEqual(parse_admin({'name':'operator','sshPublicKey':PUBLIC_KEY})['name'], 'operator')
        for key in ('ssh-ed25519 ' + 'A'*68, 'PRIVATE KEY', PUBLIC_KEY+'\ncommand=bad'):
            with self.assertRaises(BlunixError): parse_admin({'name':'operator','sshPublicKey':key})

    def test_replacement_restores_symlinks_files_and_modes_on_failure(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)/'file'; path.write_bytes(b'original'); path.chmod(0o640)
            with self.assertRaises(RuntimeError):
                with replacement(path, b'temporary', 0o755): raise RuntimeError()
            self.assertEqual(path.read_bytes(), b'original'); self.assertEqual(path.stat().st_mode & 0o777, 0o640)
            path.unlink(); path.symlink_to('/nonexistent')
            with replacement(path, b'temporary', 0o644): self.assertFalse(path.is_symlink())
            self.assertEqual(os.readlink(path), '/nonexistent')

    def test_apt_is_noninteractive_and_policy_dns_restored_on_failure(self):
        with tempfile.TemporaryDirectory() as root:
            dns = Path(root)/'etc/resolv.conf'; dns.parent.mkdir(); dns.symlink_to('/run/systemd/resolve/stub-resolv.conf')
            calls=[]
            def runner(argv, **kwargs):
                calls.append(argv)
                self.assertEqual((Path(root)/'usr/sbin/policy-rc.d').read_text(), '#!/bin/sh\nexit 101\n')
                if 'install' in argv: raise subprocess.CalledProcessError(1, argv)
                return subprocess.CompletedProcess(argv, 0, stdout=b'')
            with self.assertRaises(subprocess.CalledProcessError): provision(root, ['git'], None, runner)
            self.assertEqual(calls[1][-3:], ['install','--','git'])
            self.assertIn('DEBIAN_FRONTEND=noninteractive',calls[1])
            self.assertTrue(dns.is_symlink())
            self.assertFalse((Path(root)/'usr/sbin/policy-rc.d').exists())

    def test_first_boot_speech_profile_also_reads_address_once(self):
        reads = []
        log = []
        result = ask_hostname(lambda: reads.append(True) or 'https://ada.blnx.io/', log.append, True)
        self.assertEqual(result, 'ada.blnx.io')
        self.assertEqual(len(reads), 1)
        self.assertFalse(any('Say yes' in line for line in log))

    def test_https_address_is_accepted_but_paths_credentials_and_redirects_are_not(self):
        self.assertEqual(expand_build_host('https://v2.ada.blnx.io/'), 'v2.ada.blnx.io')
        for value in ('http://ada.blnx.io/', 'https://ada.blnx.io/x', 'https://evil@ada.blnx.io/', 'https://ada.blnx.io/?q=x', 'https://ada.blnx.io:443/'):
            with self.assertRaises(BlunixError): expand_build_host(value)
