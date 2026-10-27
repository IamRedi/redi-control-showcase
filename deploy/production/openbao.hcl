ui = false

api_addr     = "https://openbao:8200"
cluster_addr = "https://openbao:8201"

storage "raft" {
  path                   = "/openbao/file"
  node_id                = "redi-control-openbao-1"
  performance_multiplier = 1
}

listener "tcp" {
  address                  = "0.0.0.0:8200"
  cluster_address          = "0.0.0.0:8201"
  tls_cert_file            = "/run/openbao/tls.crt"
  tls_key_file             = "/run/openbao/tls.key"
  tls_disable_client_certs = true
}

seal "static" {
  current_key_id = "redi-control-tpm-v1"
  current_key    = "file:///run/openbao/unseal.key"
}

audit "file" "persistent-file" {
  description = "REDI CONTROL OpenBao audit log"
  options = {
    file_path = "/openbao/logs/audit.json"
    mode      = "0600"
    log_raw   = "false"
    format    = "json"
  }
}
