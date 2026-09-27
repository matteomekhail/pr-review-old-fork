use serde::Deserialize;
use std::path::Path;
use std::sync::OnceLock;
use tokio::process::Command;

const QUEUE_FIELDS: &str = r#"
... on PullRequest {
  id number title url isDraft
  createdAt updatedAt additions deletions changedFiles
  headRefName baseRefName reviewDecision
  author { login avatarUrl }
  repository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}"#;

const MAX_MERGE_STATE_IDS: usize = 25;

const MAX_DIFF_FALLBACK_FILES: usize = 3000;
const SYSTEM_ONE_URL: &str = "https://openrouter.ai/api/v1/systemone";
const MAX_READINESS_STATE_BYTES: usize = 60_000;

static OPENROUTER_KEY: OnceLock<Option<String>> = OnceLock::new();

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum QueueKind {
    Review,
    Mine,
    Involved,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum MergeMethod {
    Squash,
    Merge,
    Rebase,
}

#[derive(Deserialize)]
struct PullFile {
    filename: String,
    previous_filename: Option<String>,
    status: String,
    patch: Option<String>,
}

fn gh_binary() -> &'static str {
    ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"]
        .into_iter()
        .find(|candidate| Path::new(candidate).exists())
        .unwrap_or("gh")
}

async fn gh(args: &[&str]) -> Result<String, String> {
    let output = Command::new(gh_binary())
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|error| format!("could not run gh: {error}"))?;
    if output.status.success() {
        return String::from_utf8(output.stdout).map_err(|error| error.to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let message = if stderr.is_empty() { format!("gh exited with {}", output.status) } else { stderr };
    eprintln!("[gh] {} -> {}", args.iter().take(3).cloned().collect::<Vec<_>>().join(" "), message.lines().next().unwrap_or(""));
    Err(message)
}

fn is_safe_segment(segment: &str) -> bool {
    !segment.is_empty()
        && !segment.starts_with('-')
        && segment.len() <= 100
        && segment.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
}

fn validate_repo(repo: &str) -> Result<(), String> {
    match repo.split_once('/') {
        Some((owner, name)) if is_safe_segment(owner) && is_safe_segment(name) => Ok(()),
        _ => Err(format!("invalid repository: {repo}")),
    }
}

fn search_query(kind: QueueKind) -> &'static str {
    match kind {
        QueueKind::Review => "is:pr is:open archived:false review-requested:@me sort:updated-desc",
        QueueKind::Mine => "is:pr is:open archived:false author:@me sort:updated-desc",
        QueueKind::Involved => "is:pr is:open archived:false involves:@me sort:updated-desc",
    }
}

#[tauri::command]
async fn queue(kind: QueueKind) -> Result<String, String> {
    let query = format!(
        "query($q: String!, $endCursor: String) {{ search(query: $q, type: ISSUE, first: 100, after: $endCursor) {{ issueCount pageInfo {{ hasNextPage endCursor }} nodes {{ {QUEUE_FIELDS} }} }} }}"
    );
    gh(&["api", "graphql", "--paginate", "--slurp", "-f", &format!("query={query}"), "-f", &format!("q={}", search_query(kind))]).await
}

fn is_node_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '='))
}

#[tauri::command]
async fn merge_states(ids: Vec<String>) -> Result<String, String> {
    if ids.is_empty() || ids.len() > MAX_MERGE_STATE_IDS || !ids.iter().all(|id| is_node_id(id)) {
        return Err("invalid pull request ids".to_string());
    }
    let query = "query($ids: [ID!]!) { nodes(ids: $ids) { ... on PullRequest { id mergeable mergeStateStatus } } }";
    let mut args: Vec<String> = vec!["api".into(), "graphql".into(), "-f".into(), format!("query={query}")];
    for id in &ids {
        args.push("-f".into());
        args.push(format!("ids[]={id}"));
    }
    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    gh(&borrowed).await
}

#[tauri::command]
async fn body(repo: String, number: u64) -> Result<String, String> {
    validate_repo(&repo)?;
    let (owner, name) = repo.split_once('/').ok_or("invalid repository")?;
    let query = "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { bodyHTML } } }";
    gh(&[
        "api", "graphql",
        "-f", &format!("query={query}"),
        "-F", &format!("owner={owner}"),
        "-F", &format!("name={name}"),
        "-F", &format!("number={number}"),
        "--jq", ".data.repository.pullRequest.bodyHTML",
    ])
    .await
}

#[tauri::command]
async fn diff(repo: String, number: u64) -> Result<String, String> {
    validate_repo(&repo)?;
    let path = format!("repos/{repo}/pulls/{number}");
    match gh(&["api", &path, "-H", "Accept: application/vnd.github.v3.diff"]).await {
        Ok(patch) => Ok(patch),
        Err(error) if error.contains("too_large") || error.contains("406") || error.contains("exceeded") => {
            diff_from_files(&repo, number).await
        }
        Err(error) => Err(error),
    }
}

async fn diff_from_files(repo: &str, number: u64) -> Result<String, String> {
    let path = format!("repos/{repo}/pulls/{number}/files?per_page=100");
    let raw = gh(&["api", "--paginate", "--slurp", &path]).await?;
    let pages: Vec<Vec<PullFile>> = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    let patch = pages
        .into_iter()
        .flatten()
        .take(MAX_DIFF_FALLBACK_FILES)
        .map(|file| file_patch(&file))
        .collect::<Vec<_>>()
        .join("");
    Ok(patch)
}

fn file_patch(file: &PullFile) -> String {
    let old_name = file.previous_filename.as_deref().unwrap_or(&file.filename);
    let (old_path, new_path) = match file.status.as_str() {
        "added" => ("/dev/null".to_string(), format!("b/{}", file.filename)),
        "removed" => (format!("a/{old_name}"), "/dev/null".to_string()),
        _ => (format!("a/{old_name}"), format!("b/{}", file.filename)),
    };
    let body = file.patch.as_deref().unwrap_or("");
    let rename = if file.status == "renamed" {
        format!("rename from {old_name}\nrename to {}\n", file.filename)
    } else {
        String::new()
    };
    let hunks = if body.is_empty() { String::new() } else { format!("--- {old_path}\n+++ {new_path}\n{body}\n") };
    format!("diff --git a/{old_name} b/{}\n{rename}{hunks}", file.filename)
}

#[tauri::command]
async fn approve(repo: String, number: u64) -> Result<String, String> {
    validate_repo(&repo)?;
    gh(&["pr", "review", &number.to_string(), "-R", &repo, "--approve"]).await
}

#[tauri::command]
async fn merge(repo: String, number: u64, method: MergeMethod) -> Result<String, String> {
    validate_repo(&repo)?;
    let flag = match method {
        MergeMethod::Squash => "--squash",
        MergeMethod::Merge => "--merge",
        MergeMethod::Rebase => "--rebase",
    };
    let output = gh(&["pr", "merge", &number.to_string(), "-R", &repo, flag]).await?;
    Ok(if output.trim().is_empty() { "Merge requested".to_string() } else { output })
}

fn resolve_openrouter_key() -> Option<String> {
    if let Ok(key) = std::env::var("OPENROUTER_API_KEY") {
        if !key.trim().is_empty() {
            return Some(key.trim().to_string());
        }
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = std::process::Command::new(shell)
        .args(["-l", "-i", "-c", "printf %s \"$OPENROUTER_API_KEY\""])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    let key = String::from_utf8(output.stdout).ok()?.trim().to_string();
    (key.starts_with("sk-") && !key.contains(char::is_whitespace)).then_some(key)
}

fn openrouter_key() -> Option<&'static str> {
    OPENROUTER_KEY.get_or_init(resolve_openrouter_key).as_deref()
}

#[tauri::command]
async fn review_context(repo: String, number: u64) -> Result<String, String> {
    validate_repo(&repo)?;
    let (owner, name) = repo.split_once('/').ok_or("invalid repository")?;
    let query = "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { body files(first: 100) { totalCount nodes { path additions deletions } } reviews(last: 20) { nodes { state bodyText author { login __typename } } } comments(last: 25) { nodes { bodyText author { login __typename } } } reviewThreads(last: 100) { nodes { isResolved isOutdated } } } } }";
    gh(&[
        "api", "graphql",
        "-f", &format!("query={query}"),
        "-F", &format!("owner={owner}"),
        "-F", &format!("name={name}"),
        "-F", &format!("number={number}"),
    ])
    .await
}

#[tauri::command]
async fn readiness_available() -> bool {
    tauri::async_runtime::spawn_blocking(|| openrouter_key().is_some()).await.unwrap_or(false)
}

#[tauri::command]
async fn readiness(request: String) -> Result<String, String> {
    if request.len() > MAX_READINESS_STATE_BYTES {
        return Err("readiness request too large".to_string());
    }
    let key = tauri::async_runtime::spawn_blocking(openrouter_key)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("OPENROUTER_API_KEY not configured")?;
    let response = http_client()
        .post(SYSTEM_ONE_URL)
        .bearer_auth(key)
        .header("Content-Type", "application/json")
        .header("X-Title", "PR Review")
        .body(request)
        .send()
        .await
        .map_err(|error| error.without_url().to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|error| error.without_url().to_string())?;
    if status.is_success() {
        return Ok(text);
    }
    Err(format!("Jev {status}: {}", text.chars().take(300).collect::<String>()))
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("http client")
    })
}

#[tauri::command]
async fn open_in_browser(url: String) -> Result<(), String> {
    let is_github = url.starts_with("https://github.com/");
    let is_github_media = ["https://camo.githubusercontent.com/", "https://private-user-images.githubusercontent.com/", "https://user-images.githubusercontent.com/", "https://raw.githubusercontent.com/", "https://objects.githubusercontent.com/"]
        .iter()
        .any(|prefix| url.starts_with(prefix));
    if !(is_github || is_github_media) || url.chars().any(|character| character.is_whitespace() || character.is_control()) {
        return Err("refusing to open non-GitHub URL".to_string());
    }
    Command::new("/usr/bin/open").arg(&url).status().await.map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![queue, merge_states, body, diff, approve, merge, open_in_browser, review_context, readiness_available, readiness])
        .run(tauri::generate_context!())
        .expect("error while running PR Review");
}
