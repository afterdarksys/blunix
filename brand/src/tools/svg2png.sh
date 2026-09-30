#!/bin/bash
# svg2png.sh in.svg out.png W H
D=$(cd "$(dirname "$0")"; pwd)
T=$(mktemp -d "$D/.r.XXXX")
echo "<html><body style=\"margin:0\"><img src=\"file://$1\" width=\"$3\" height=\"$4\" style=\"display:block\"></body></html>" > $T/p.html
"$D/render.sh" $T/p.html "$2" $3 $4
rm -rf $T
