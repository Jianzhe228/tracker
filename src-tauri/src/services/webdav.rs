use reqwest::blocking::Client;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use std::time::Duration;

pub struct WebDavClient {
    url: String,
    username: String,
    password: String,
    path: String,
    client: Client,
}

impl WebDavClient {
    pub fn new(url: &str, username: &str, password: &str, path: &str) -> Result<Self, String> {
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        // Normalize URL: ensure trailing slash
        let url = if url.ends_with('/') {
            url.to_string()
        } else {
            format!("{}/", url)
        };

        // Normalize path: strip leading/trailing slashes
        let path = path.trim_matches('/').to_string();

        Ok(Self {
            url,
            username: username.to_string(),
            password: password.to_string(),
            path,
            client,
        })
    }

    fn base_url(&self) -> String {
        if self.path.is_empty() {
            self.url.clone()
        } else {
            format!("{}{}/", self.url, self.path)
        }
    }

    fn file_url(&self) -> String {
        format!("{}tracker_sync.json", self.base_url())
    }

    fn basic_auth_header(&self) -> String {
        use std::io::Write;
        let mut buf = Vec::new();
        write!(buf, "{}:{}", self.username, self.password).unwrap();
        format!("Basic {}", base64_encode(&buf))
    }

    /// Test connection by sending a PROPFIND request to the base path.
    /// If the path returns 404, automatically create it via MKCOL and retry.
    pub fn test_connection(&self) -> Result<(), String> {
        let auth = self.basic_auth_header();
        let url = self.base_url();

        let resp = self
            .client
            .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &url)
            .header(AUTHORIZATION, &auth)
            .header("Depth", "0")
            .header(CONTENT_TYPE, "application/xml")
            .send()
            .map_err(|e| format!("Connection failed: {}", e))?;

        let status = resp.status().as_u16();
        if status == 207 || status == 200 {
            return Ok(());
        } else if status == 401 || status == 403 {
            return Err("Authentication failed: incorrect username or password".to_string());
        } else if status == 404 && !self.path.is_empty() {
            // Path doesn't exist yet — try to create it
            self.ensure_directory()?;

            // Retry PROPFIND after creating directory
            let resp2 = self
                .client
                .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &url)
                .header(AUTHORIZATION, &auth)
                .header("Depth", "0")
                .header(CONTENT_TYPE, "application/xml")
                .send()
                .map_err(|e| format!("Connection failed after creating directory: {}", e))?;

            let status2 = resp2.status().as_u16();
            if status2 == 207 || status2 == 200 {
                return Ok(());
            }
            return Err(format!(
                "Path created but verification failed, status: {}",
                status2
            ));
        }

        Err(format!("Unexpected response status: {}", status))
    }

    /// Create the remote directory if it doesn't exist.
    pub fn ensure_directory(&self) -> Result<(), String> {
        if self.path.is_empty() {
            return Ok(());
        }

        let auth = self.basic_auth_header();
        let url = self.base_url();

        let resp = self
            .client
            .request(reqwest::Method::from_bytes(b"MKCOL").unwrap(), &url)
            .header(AUTHORIZATION, &auth)
            .send()
            .map_err(|e| format!("Failed to create directory: {}", e))?;

        let status = resp.status().as_u16();
        // 201 = Created, 405 = Already exists, 301 = redirect (some servers)
        if status == 201 || status == 405 || (200..300).contains(&status) {
            Ok(())
        } else if status == 401 || status == 403 {
            Err("Authentication failed".to_string())
        } else {
            Err(format!("Failed to create directory, status: {}", status))
        }
    }

    /// Upload data as tracker_sync.json via PUT.
    pub fn upload(&self, data: &[u8]) -> Result<(), String> {
        let auth = self.basic_auth_header();
        let url = self.file_url();

        let resp = self
            .client
            .put(&url)
            .header(AUTHORIZATION, &auth)
            .header(CONTENT_TYPE, "application/json")
            .body(data.to_vec())
            .send()
            .map_err(|e| format!("Upload failed: {}", e))?;

        let status = resp.status().as_u16();
        if (200..300).contains(&status) {
            Ok(())
        } else if status == 401 || status == 403 {
            Err("Authentication failed".to_string())
        } else {
            Err(format!("Upload failed with status: {}", status))
        }
    }

    /// Download tracker_sync.json via GET.
    pub fn download(&self) -> Result<Vec<u8>, String> {
        let auth = self.basic_auth_header();
        let url = self.file_url();

        let resp = self
            .client
            .get(&url)
            .header(AUTHORIZATION, &auth)
            .send()
            .map_err(|e| format!("Download failed: {}", e))?;

        let status = resp.status().as_u16();
        if status == 404 {
            return Err("Remote file not found. Please upload first.".to_string());
        }
        if status == 401 || status == 403 {
            return Err("Authentication failed".to_string());
        }
        if !(200..300).contains(&status) {
            return Err(format!("Download failed with status: {}", status));
        }

        resp.bytes()
            .map(|b| b.to_vec())
            .map_err(|e| format!("Failed to read response body: {}", e))
    }
}

/// Simple base64 encoding (no external dependency needed).
fn base64_encode(input: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    let chunks = input.chunks(3);

    for chunk in chunks {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };

        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);

        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }

        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }

    result
}
