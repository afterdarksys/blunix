-- Display only ("Signed in as ..."), refreshed from the ID token at every sign-in.
-- Identity stays (iss, sub); nothing authorizes on this column.
ALTER TABLE accounts ADD COLUMN display_name TEXT;
