#!/usr/bin/env node

/**
 * validate-env.js
 * Environment validation script to check required environment variables
 */

const fs = require('fs');
const path = require('path');

// Load environment variables - check if dotenv is available
try {
    require('dotenv').config();
} catch (error) {
    console.warn('⚠️  dotenv not available, using system environment only');
}

const requiredVars = {
    // Core API Keys
    'OPENAI_API_KEY': {
        required: false,
        description: 'OpenAI API key for Whisper STT (alternative to HuggingFace)'
    },
    'HUGGINGFACE_API_KEY': {
        required: false,
        description: 'HuggingFace API key for Whisper STT (alternative to OpenAI)'
    },

    // Google Services
    'GOOGLE_CLIENT_ID': {
        required: true,
        description: 'Google OAuth client ID for Calendar/Tasks integration'
    },
    'GOOGLE_CLIENT_SECRET': {
        required: true,
        description: 'Google OAuth client secret'
    },
    'GOOGLE_REFRESH_TOKEN': {
        required: true,
        description: 'Google OAuth refresh token'
    },

    // Zalo Configuration
    'BOSS_ZALO_ID': {
        required: true,
        description: 'Zalo user ID for the boss/manager'
    },

    // System Configuration
    'STT_PROVIDER': {
        required: false,
        description: 'Speech-to-text provider (whisper)',
        default: 'whisper'
    },
    'HUGGINGFACE_WHISPER_MODEL': {
        required: false,
        description: 'HuggingFace Whisper model to use',
        default: 'openai/whisper-large-v3'
    }
};

function validateEnvironment() {
    console.log('🔍 Validating environment variables...\n');

    let hasErrors = false;
    let hasWarnings = false;

    // Check if .env file exists
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) {
        console.error('❌ .env file not found!');
        console.log('📝 Create a .env file based on .env.example\n');
        return false;
    }

    // Validate each variable
    for (const [varName, config] of Object.entries(requiredVars)) {
        const value = process.env[varName];

        if (!value || value.trim() === '') {
            if (config.required) {
                console.error(`❌ ${varName}: MISSING (Required)`);
                console.log(`   ${config.description}\n`);
                hasErrors = true;
            } else {
                console.warn(`⚠️  ${varName}: Not set (Optional)`);
                console.log(`   ${config.description}`);
                if (config.default) {
                    console.log(`   Default: ${config.default}`);
                }
                console.log('');
                hasWarnings = true;
            }
        } else {
            console.log(`✅ ${varName}: Set`);
        }
    }

    // Special validation for STT provider
    const sttProvider = process.env.STT_PROVIDER || 'whisper';
    if (sttProvider === 'whisper') {
        const hasOpenAI = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim();
        const hasHuggingFace = process.env.HUGGINGFACE_API_KEY && process.env.HUGGINGFACE_API_KEY.trim();

        if (!hasOpenAI && !hasHuggingFace) {
            console.error('\n❌ STT Configuration Error:');
            console.error('   For STT_PROVIDER=whisper, you need either:');
            console.error('   - OPENAI_API_KEY (for OpenAI Whisper)');
            console.error('   - HUGGINGFACE_API_KEY (for HuggingFace Whisper)');
            hasErrors = true;
        }
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    if (hasErrors) {
        console.error('❌ Environment validation FAILED');
        console.log('Please fix the missing required variables before starting the application.');
        return false;
    } else if (hasWarnings) {
        console.warn('⚠️  Environment validation completed with warnings');
        console.log('Some optional variables are not set. This may limit functionality.');
        return true;
    } else {
        console.log('✅ Environment validation PASSED');
        console.log('All required variables are properly configured.');
        return true;
    }
}

if (require.main === module) {
    const isValid = validateEnvironment();
    process.exit(isValid ? 0 : 1);
}

module.exports = { validateEnvironment };
