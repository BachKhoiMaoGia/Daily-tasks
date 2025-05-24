# Security Guidelines

## API Key Management

⚠️ **NEVER commit API keys, tokens, or credentials to version control!**

### Environment Variables
All sensitive configuration should use environment variables:

```bash
# Required API Keys
OPENAI_API_KEY=your_openai_key_here
HUGGINGFACE_API_KEY=your_huggingface_key_here
GITHUB_API_KEY=your_github_key_here

# Google OAuth Credentials
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REFRESH_TOKEN=your_refresh_token
```

### Test Files
When creating test files, always use environment variables instead of hardcoded values:

```javascript
// ✅ GOOD
const API_KEY = process.env.HUGGINGFACE_API_KEY;

// ❌ BAD
const API_KEY = 'hf_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
```

### Checking for Exposed Keys
Before committing, run this command to check for potential exposed keys:

```bash
# Search for potential API key patterns
grep -r "hf_[A-Za-z0-9]\{30,\}" . --exclude-dir=node_modules
grep -r "sk-[A-Za-z0-9]\{30,\}" . --exclude-dir=node_modules
grep -r "ghp_[A-Za-z0-9]\{30,\}" . --exclude-dir=node_modules
```

### .gitignore
Ensure your `.gitignore` includes:
```
.env
.env.local
.env.production
*.key
secrets.json
```

## Recent Security Fixes

✅ **Fixed exposed API keys in:**
- `test-hf-models.cjs` - HuggingFace API key
- `test-github-stt.cjs` - GitHub API key  
- `get-google-refresh-token.js` - Google OAuth credentials
- `test-hf-whisper.js` - Already fixed
- `test-hf-whisper.cjs` - Already fixed

## Model Updates

✅ **Updated Whisper model version:**
- Changed from deprecated `openai/whisper-large-v2` to `openai/whisper-large-v3`
- Updated in config files and all test files
- Better performance and reliability with v3
