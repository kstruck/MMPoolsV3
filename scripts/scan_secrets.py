import os
import re
import sys
import subprocess

# Regex patterns for common secrets
SECRET_PATTERNS = {
    "AWS Access Key": r"AKIA[0-9A-Z]{16}",
    "AWS Secret Key": r"(?i)aws_secret_access_key",
    "Private Key": r"-----BEGIN PRIVATE KEY-----",
    "Generic API Key": r"(?i)api_key\s*[:=]\s*['\"][a-zA-Z0-9]{20,}['\"]",
    "Firebase Key": r"(?i)AIza[0-9A-Za-z-_]{35}",
}

def get_staged_files():
    """Returns a list of staged files."""
    try:
        result = subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            capture_output=True,
            text=True,
            check=True
        )
        return [f for f in result.stdout.splitlines() if os.path.isfile(f)]
    except subprocess.CalledProcessError:
        return []

def scan_file(filepath):
    """Scans a file for potential secrets."""
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
            
        found_secrets = []
        for name, pattern in SECRET_PATTERNS.items():
            if re.search(pattern, content):
                found_secrets.append(name)
        return found_secrets
    except Exception as e:
        print(f"Warning: Could not scan {filepath}: {e}")
        return []

def main():
    print("running secret scan...")
    staged_files = get_staged_files()
    if not staged_files:
        print("No staged files to check.")
        return 0

    issues_found = False
    for filepath in staged_files:
        # Skip lock files and this script
        if filepath.endswith("lock.json") or filepath.endswith("scan_secrets.py"):
            continue
            
        secrets = scan_file(filepath)
        if secrets:
            print(f"FAILED: Potential secrets found in {filepath}: {', '.join(secrets)}")
            issues_found = True

    if issues_found:
        print("Commit rejected. Please remove secrets before committing.")
        return 1
    
    print("Secret scan passed.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
