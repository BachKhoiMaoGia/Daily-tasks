# Environment Variables Setup for Render.com

## 🔧 **REQUIRED ENVIRONMENT VARIABLES:**

### **1. OpenAI/GitHub Models API**
```bash
OPENAI_API_KEY=your_openai_or_github_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
# OR for GitHub Models:
# OPENAI_BASE_URL=https://models.github.ai/inference
```

### **2. HuggingFace (Speech-to-Text)**
```bash
HUGGINGFACE_API_KEY=your_huggingface_key_here
HUGGINGFACE_WHISPER_MODEL=openai/whisper-large-v3
STT_PROVIDER=whisper
```

### **3. Google Calendar & Tasks** 
```bash
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=https://your-app.render.com/gcal/oauth
GOOGLE_REFRESH_TOKEN=your_refresh_token_here
```

### **4. Zalo Bot Configuration**
```bash
BOSS_ZALO_ID=your_boss_zalo_id_here
ZALO_COOKIE_PATH=.cookies.txt
```
⚠️ **IMPORTANT:** `ZALO_COOKIE_PATH=.cookies.txt` - correct path for production

### **5. Server & System**
```bash
PORT=3000
LOG_LEVEL=info
FFMPEG_PATH=/usr/bin/ffmpeg
AUDIO_TMP=/tmp
MAX_AUDIO_MIN=10
```

### **6. Features**
```bash
USE_LLM=false
```

---

## 🚀 **RENDER SETUP GUIDE:**

### **Step 1: Access Render Dashboard**
1. Go to [render.com](https://render.com)
2. Sign in to your account
3. Click "New +" → "Web Service"

### **Step 2: Connect Repository**
1. Connect your GitHub repository
2. Select the `yen-nhi-task-bot` project
3. Choose branch: `main`

### **Step 3: Configure Build Settings**
```bash
Build Command: npm install && npm run build
Start Command: npm start
```

### **Step 4: Add Environment Variables**
In the "Environment" section, add all variables listed above with your actual values.

### **Step 5: Deploy**
1. Click "Create Web Service"
2. Wait for deployment to complete
3. Test the application

---

## 🔐 **SECURITY NOTES:**

### **API Key Security**
- ⚠️ Never commit API keys to version control
- ✅ Always use environment variables
- 🔄 Rotate keys regularly

### **Google OAuth Setup**
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create OAuth 2.0 credentials
3. Add your Render URL to authorized redirect URIs
4. Use `get-google-refresh-token.js` to generate refresh token

### **HuggingFace API**
1. Sign up at [huggingface.co](https://huggingface.co)
2. Go to Settings → Access Tokens
3. Create a new token with "Read" permissions

---

## ✅ **VALIDATION:**

Before deployment, run:
```bash
npm run validate-env
```

This will check that all required environment variables are properly configured.

---

## 🆘 **TROUBLESHOOTING:**

### **Common Issues:**

1. **Build Fails:**
   - Check that all environment variables are set
   - Verify Node.js version compatibility

2. **STT Not Working:**
   - Ensure either OPENAI_API_KEY or HUGGINGFACE_API_KEY is set
   - Check API key permissions

3. **Google Calendar Integration Fails:**
   - Verify OAuth redirect URI matches Render URL
   - Check refresh token is valid

### **Logs:**
Monitor logs in Render dashboard for detailed error messages.

---

**Last Updated:** May 24, 2025
