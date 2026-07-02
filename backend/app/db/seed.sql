INSERT OR IGNORE INTO users_profile (id, cash_balance) VALUES ('default', 10000.0);

INSERT OR IGNORE INTO watchlist (user_id, ticker) VALUES
  ('default', 'AAPL'), ('default', 'GOOGL'), ('default', 'MSFT'),
  ('default', 'AMZN'), ('default', 'TSLA'),  ('default', 'NVDA'),
  ('default', 'META'), ('default', 'JPM'),   ('default', 'V'),
  ('default', 'NFLX');
