ALTER TABLE control.oauth_transactions
  DROP CONSTRAINT oauth_transactions_post_connect_path_check,
  ADD CONSTRAINT oauth_transactions_post_connect_path_check
    CHECK (post_connect_path IN (
      '/en/social/accounts',
      '/de/social/accounts',
      '/sq/social/accounts'
    ));

COMMENT ON CONSTRAINT oauth_transactions_post_connect_path_check
  ON control.oauth_transactions IS
  'Server-controlled post-OAuth destinations for enabled dashboard locales.';
