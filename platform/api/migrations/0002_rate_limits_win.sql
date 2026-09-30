-- Rate-limit windows are pruned by age, so the prune needs an index on the window.
CREATE INDEX rate_limits_win ON rate_limits (win);
