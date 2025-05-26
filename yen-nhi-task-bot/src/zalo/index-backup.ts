/**
 * zalo/index.ts
 * Zalo client using zca-js@2.0.0-beta.21 (QR login, message listener).
 */
import { Zalo, type API, type Credentials, ThreadType } from 'zca-js';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { storeQRData, clearQR } from './qr.js';
import logger from '../utils/logger.js';

let zaloInstance: Zalo | null = null;
let apiInstance: API | null = null;

// Cookie management constants
const COOKIE_BACKUP_PATH = config.zaloCookiePath + '.backup';
const COOKIE_VALIDATE_INTERVAL = 30 * 60 * 1000; // 30 minutes
const MAX_LOGIN_RETRIES = 3;

interface CookieMetadata {
    cookies: any[];
    timestamp: number;
    userId?: string;
    loginMethod: 'qr' | 'cookies';
    retryCount?: number;
}

/**
 * Validate cookie structure and content
 */
function validateCookies(cookies: any[]): boolean {
    if (!Array.isArray(cookies) || cookies.length === 0) {
        return false;
    }

    // Check if cookies have required fields
    const hasValidCookies = cookies.some(cookie => {
        return cookie && (
            (cookie.name && cookie.value) ||
            (cookie.key && cookie.value) ||
            typeof cookie === 'string'
        );
    });

    return hasValidCookies;
}

/**
 * Save cookies with metadata
 */
function saveCookiesWithMetadata(cookies: any[], userId?: string, loginMethod: 'qr' | 'cookies' = 'qr') {
    const metadata: CookieMetadata = {
        cookies,
        timestamp: Date.now(),
        userId,
        loginMethod,
        retryCount: 0
    };

    try {
        // Save main cookie file
        fs.writeFileSync(config.zaloCookiePath, JSON.stringify(metadata, null, 2), 'utf8');

        // Create backup
        fs.writeFileSync(COOKIE_BACKUP_PATH, JSON.stringify(metadata, null, 2), 'utf8');

        logger.info(`[Zalo] Saved cookies with metadata (${cookies.length} cookies, method: ${loginMethod})`);
        return true;
    } catch (err) {
        logger.error('[Zalo] Failed to save cookies:', err);
        return false;
    }
}

/**
 * Load cookies with metadata
 */
function loadCookiesWithMetadata(): CookieMetadata | null {
    try {
        if (!fs.existsSync(config.zaloCookiePath)) {
            return null;
        }

        const data = fs.readFileSync(config.zaloCookiePath, 'utf8');
        const parsed = JSON.parse(data);

        // Handle legacy cookie format (just array)
        if (Array.isArray(parsed)) {
            logger.info('[Zalo] Legacy cookie format detected, converting...');
            const metadata: CookieMetadata = {
                cookies: parsed,
                timestamp: Date.now(),
                loginMethod: 'qr'
            };
            saveCookiesWithMetadata(parsed, undefined, 'qr');
            return metadata;
        }

        // Validate metadata structure
        if (!parsed.cookies || !Array.isArray(parsed.cookies)) {
            logger.warn('[Zalo] Invalid cookie metadata structure');
            return null;
        }

        return parsed as CookieMetadata;
    } catch (err) {
        logger.error('[Zalo] Failed to load cookie metadata:', err);
        return null;
    }
}

/**
 * Check if cookies are expired (older than 7 days)
 */
function areCookiesExpired(metadata: CookieMetadata): boolean {
    const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
    return Date.now() - metadata.timestamp > COOKIE_MAX_AGE;
}

/**
 * Restore cookies from backup
 */
function restoreFromBackup(): CookieMetadata | null {
    try {
        if (!fs.existsSync(COOKIE_BACKUP_PATH)) {
            return null;
        }

        const data = fs.readFileSync(COOKIE_BACKUP_PATH, 'utf8');
        const metadata = JSON.parse(data) as CookieMetadata;

        if (validateCookies(metadata.cookies)) {
            logger.info('[Zalo] Restored cookies from backup');
            fs.writeFileSync(config.zaloCookiePath, JSON.stringify(metadata, null, 2), 'utf8');
            return metadata;
        }
    } catch (err) {
        logger.error('[Zalo] Failed to restore from backup:', err);
    }
    return null;
}

/**
 * Clean up invalid cookie files
 */
function cleanupInvalidCookies() {
    try {
        if (fs.existsSync(config.zaloCookiePath)) {
            fs.unlinkSync(config.zaloCookiePath);
        }
        if (fs.existsSync(COOKIE_BACKUP_PATH)) {
            fs.unlinkSync(COOKIE_BACKUP_PATH);
        }
        logger.info('[Zalo] Cleaned up invalid cookie files');
    } catch (err) {
        logger.error('[Zalo] Failed to cleanup cookie files:', err);
    }
}

/**
 * Extract cookies from API instance using multiple methods
 */
async function extractCookiesFromAPI(api: API): Promise<any[] | null> {
    try {
        let cookies: any[] | null = null;

        // Method 1: Direct properties (with type assertion)
        const apiAny = api as any;
        cookies = apiAny.getCredentials?.()?.cookie || apiAny.credentials?.cookie || apiAny.cookie;

        // Method 2: Try internal properties
        if (!cookies && apiAny._credentials) {
            cookies = apiAny._credentials.cookie;
        }

        // Method 3: Try zalo instance cookies
        if (!cookies && zaloInstance) {
            cookies = (zaloInstance as any).credentials?.cookie || (zaloInstance as any)._credentials?.cookie;
        }

        // Method 4: Try accessing via prototype
        if (!cookies && api.constructor && api.constructor.prototype) {
            const proto = api.constructor.prototype;
            if (proto.getCredentials) {
                cookies = proto.getCredentials.call(api)?.cookie;
            }
        }

        // Method 5: Try accessing through _api or internal properties
        if (!cookies && apiAny._api) {
            cookies = apiAny._api.credentials?.cookie || apiAny._api.cookie;
        }

        // Method 6: Try accessing session or client cookies
        if (!cookies && apiAny.client) {
            cookies = apiAny.client.credentials?.cookie || apiAny.client.cookie;
        }

        // Method 7: Brute force search for any cookie-like arrays in the API object
        if (!cookies) {
            const searchForCookies = (obj: any, path = 'api'): any[] | null => {
                if (!obj || typeof obj !== 'object') return null;

                for (const [key, value] of Object.entries(obj)) {
                    if ((key.toLowerCase().includes('cookie') || key.toLowerCase().includes('credential')) && Array.isArray(value) && value.length > 0) {
                        logger.info(`[Debug] Found potential cookies at ${path}.${key}: ${value.length} items`);
                        return value;
                    }
                    if (typeof value === 'object' && value !== null && path.split('.').length < 3) {
                        const found: any[] | null = searchForCookies(value, `${path}.${key}`);
                        if (found) return found;
                    }
                }
                return null;
            };

            cookies = searchForCookies(api);
        }

        logger.info('[Zalo] Cookie extraction results:', {
            foundCookies: !!cookies,
            cookiesLength: cookies ? cookies.length : 0,
            apiType: api?.constructor?.name || 'unknown'
        });

        return cookies && validateCookies(cookies) ? cookies : null;
    } catch (err) {
        logger.error('[Zalo] Failed to extract cookies from API:', err);
        return null;
    }
}

/**
 * Get user ID from API instance
 */
async function getUserIdFromAPI(api: API): Promise<string> {
    try {
        // Try multiple methods to get user ID (with type assertion)
        const apiAny = api as any;
        let userId: string | undefined;

        if (apiAny.getCurrentUserId) {
            userId = await apiAny.getCurrentUserId();
        }

        if (!userId && apiAny.getUserInfo) {
            const userInfo = await apiAny.getUserInfo();
            userId = userInfo?.id || userInfo?.userId;
        }

        if (!userId && apiAny.currentUser) {
            userId = apiAny.currentUser.id || apiAny.currentUser.userId;
        }

        return userId || 'unknown';
    } catch (err) {
        logger.warn('[Zalo] Failed to get user ID from API:', err);
        return 'unknown';
    }
}

/**
 * Setup connection health check
 */
async function setupConnectionHealthCheck() {
    if (!apiInstance) return;

    // Set up periodic health check
    setInterval(async () => {
        try {
            // Try to get current user info as a health check
            if (apiInstance && (apiInstance as any).getUserInfo) {
                await (apiInstance as any).getUserInfo();
                logger.debug('[Zalo] Connection health check passed');
            }
        } catch (err) {
            logger.warn('[Zalo] Connection health check failed:', err);
            // Could trigger re-login logic here if needed
        }
    }, COOKIE_VALIDATE_INTERVAL);

    logger.info('[Zalo] Connection health check setup completed');
}

function getZaloInstance() {
    if (!zaloInstance) {
        zaloInstance = new Zalo();
    }
    return zaloInstance;
}

export async function login() {
    const zalo = getZaloInstance();
    let retryCount = 0;

    // Load existing cookie metadata
    let cookieMetadata = loadCookiesWithMetadata();

    // Check if we have valid cookies
    if (cookieMetadata) {
        // Check if cookies are expired
        if (areCookiesExpired(cookieMetadata)) {
            logger.warn('[Zalo] Cookies are expired, will attempt QR login');
            cleanupInvalidCookies();
            cookieMetadata = null;
        } else if (!validateCookies(cookieMetadata.cookies)) {
            logger.warn('[Zalo] Invalid cookie structure, attempting restore from backup');
            cookieMetadata = restoreFromBackup();

            if (!cookieMetadata) {
                logger.warn('[Zalo] Backup restore failed, will attempt QR login');
                cleanupInvalidCookies();
            }
        }
    }

    // Attempt login with cookies if available
    if (cookieMetadata && validateCookies(cookieMetadata.cookies)) {
        logger.info(`[Zalo] Attempting login with saved cookies (${cookieMetadata.cookies.length} cookies, age: ${Math.round((Date.now() - cookieMetadata.timestamp) / (60 * 60 * 1000))}h)`);

        while (retryCount < MAX_LOGIN_RETRIES) {
            try {
                const credentials: Credentials = {
                    imei: 'zca-js-' + Date.now(),
                    cookie: cookieMetadata.cookies,
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    language: 'vi'
                };

                const api = await zalo.login(credentials);
                apiInstance = api;

                // Update metadata with successful login
                cookieMetadata.retryCount = retryCount;
                saveCookiesWithMetadata(cookieMetadata.cookies, cookieMetadata.userId, 'cookies');

                logger.info('[Zalo] Successfully logged in with saved cookies');
                await setupConnectionHealthCheck();
                return api;

            } catch (err) {
                retryCount++;
                logger.warn(`[Zalo] Cookie login attempt ${retryCount}/${MAX_LOGIN_RETRIES} failed:`, err);

                if (retryCount >= MAX_LOGIN_RETRIES) {
                    logger.error('[Zalo] All cookie login attempts failed, falling back to QR login');
                    cleanupInvalidCookies();
                    break;
                } else {
                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
                }
            }
        }
    }

    // QR Login fallback
    logger.info('[Zalo] No valid cookies found or cookie login failed, initiating QR login...');

    try {
        const loginResult = await zalo.loginQR({
            qrPath: './qr.png',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            language: 'vi'
        }) as any;

        logger.info('[Zalo] QR Login result structure:', {
            type: typeof loginResult,
            keys: loginResult ? Object.keys(loginResult) : [],
            hasUserInfo: !!loginResult?.userInfo,
            hasCookies: !!loginResult?.cookies,
            isAPI: !!(loginResult?.sendMessage || loginResult?.listener)
        });

        let cookies: any[] | null = null;
        let userInfo: any = null;
        let api: API | null = null;

        // Extract data from login result
        if (loginResult && typeof loginResult === 'object') {
            if (loginResult.cookies && Array.isArray(loginResult.cookies)) {
                cookies = loginResult.cookies;
                userInfo = loginResult.userInfo;
                logger.info('[Zalo] Found cookies in loginResult.cookies');
            } else if (loginResult.cookie && Array.isArray(loginResult.cookie)) {
                cookies = loginResult.cookie;
                userInfo = loginResult.userInfo;
                logger.info('[Zalo] Found cookies in loginResult.cookie');
            } else if (loginResult.sendMessage || loginResult.listener) {
                api = loginResult;
                logger.info('[Zalo] LoginQR returned API instance directly');
            }
        }

        // Handle API instance return
        if (api) {
            apiInstance = api;
            logger.info('[Zalo] API instance initialized from loginQR result');

            // Try to extract and save cookies from API instance
            const extractedCookies = await extractCookiesFromAPI(api);
            if (extractedCookies && extractedCookies.length > 0) {
                const userId = await getUserIdFromAPI(api);
                saveCookiesWithMetadata(extractedCookies, userId, 'qr');
                logger.info(`[Zalo] Successfully extracted and saved ${extractedCookies.length} cookies from API`);
            } else {
                logger.warn('[Zalo] Could not extract cookies from API, will need QR login next time');
                // Save minimal metadata for session tracking
                const sessionData = {
                    note: "QR login successful but cookies not extractable",
                    timestamp: Date.now(),
                    userId: await getUserIdFromAPI(api),
                    apiType: api.constructor?.name || 'unknown'
                };
                fs.writeFileSync(config.zaloCookiePath, JSON.stringify(sessionData, null, 2), 'utf8');
            }

            clearQR();
            await setupConnectionHealthCheck();
            return api;
        }

        // Handle cookies return
        if (cookies && validateCookies(cookies)) {
            logger.info(`[Zalo] QR login successful! User: ${userInfo?.name || 'Unknown'}`);

            // Save cookies with metadata
            const userId = userInfo?.id || userInfo?.userId || 'unknown';
            saveCookiesWithMetadata(cookies, userId, 'qr');

            // Login with cookies to get API instance
            const credentials: Credentials = {
                imei: 'zca-js-' + Date.now(),
                cookie: cookies,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                language: 'vi'
            };

            const api = await zalo.login(credentials);
            apiInstance = api;
            logger.info('[Zalo] API instance initialized from saved cookies');

            clearQR();
            await setupConnectionHealthCheck();
            return api;
        } else {
            logger.error('[Zalo] QR login did not return valid cookies or API instance');
            throw new Error('QR login failed to return valid authentication data');
        }

    } catch (err) {
        logger.error('[Zalo] QR login failed:', err);
        throw err;
    }
}

export function onMessage(handler: (msg: any) => void) {
    if (apiInstance && apiInstance.listener) {
        logger.info('[Zalo] Đang thiết lập message listener...');

        apiInstance.listener.on('message', (msg: any) => {
            logger.info('[Zalo] Nhận message:', {
                from: msg.uidFrom || msg.senderId || msg.fromId,
                type: msg.type,
                content: msg.data?.content || msg.content || 'No content'
            });
            handler(msg);
        });

        // Start the listener
        apiInstance.listener.start();
        logger.info('[Zalo] Message listener đã được khởi động.');
    } else {
        logger.warn('[Zalo] API instance chưa được khởi tạo hoặc không có listener.');
    }
}

export async function sendMessage(userId: string, text: string) {
    if (apiInstance && apiInstance.sendMessage) {
        try {
            // In zca-js@2.0.0-beta.21, sendMessage expects:
            // sendMessage(message: MessageContent | string, threadId: string, type?: ThreadType)
            // For direct messages to users, threadId = userId and type = ThreadType.User
            const result = await apiInstance.sendMessage(
                {
                    msg: text,
                    mentions: []
                },
                userId, // threadId is same as userId for direct messages
                ThreadType.User // Use ThreadType.User for direct messages
            );

            logger.info(`[Zalo] Đã gửi tin nhắn tới ${userId}: ${text}`);
            return result;
        } catch (err) {
            logger.error('[Zalo] Lỗi khi gửi tin nhắn:', err);
            throw err;
        }
    } else {
        logger.error('[Zalo] API instance chưa được khởi tạo hoặc không có sendMessage.');
        throw new Error('Zalo API chưa sẵn sàng để gửi tin nhắn.');
    }
}

/**
 * Test if current API connection is still valid
 */
export async function testConnection(): Promise<boolean> {
    if (!apiInstance) return false;

    try {
        const apiAny = apiInstance as any;

        // Try to perform a simple API call
        if (apiAny.getUserInfo) {
            await apiAny.getUserInfo();
            return true;
        }

        // Alternative: try to get current user ID
        if (apiAny.getCurrentUserId) {
            const userId = await apiAny.getCurrentUserId();
            if (userId && userId !== 'unknown') {
                return true;
            }
        }

        return false;
    } catch (err) {
        logger.warn('[Zalo] Connection test failed:', err);
        return false;
    }
}

/**
 * Auto-refresh login if connection is lost
 */
export async function autoRefreshLogin(): Promise<boolean> {
    try {
        logger.info('[Zalo] Attempting auto-refresh login...');

        const cookieMetadata = loadCookiesWithMetadata();
        if (!cookieMetadata || !validateCookies(cookieMetadata.cookies)) {
            logger.warn('[Zalo] No valid cookies for auto-refresh, QR login required');
            return false;
        }

        const zalo = getZaloInstance();
        const credentials: Credentials = {
            imei: 'zca-js-' + Date.now(),
            cookie: cookieMetadata.cookies,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            language: 'vi'
        };

        const api = await zalo.login(credentials);
        apiInstance = api;

        // Update timestamp for successful refresh
        cookieMetadata.timestamp = Date.now();
        saveCookiesWithMetadata(cookieMetadata.cookies, cookieMetadata.userId, 'cookies');

        logger.info('[Zalo] Auto-refresh login successful');
        return true;
    } catch (err) {
        logger.error('[Zalo] Auto-refresh login failed:', err);
        return false;
    }
}

/**
 * Get current login status and cookie info
 */
export function getLoginStatus(): {
    isLoggedIn: boolean;
    hasValidCookies: boolean;
    cookieAge?: number;
    userId?: string;
    loginMethod?: string;
} {
    const cookieMetadata = loadCookiesWithMetadata();

    return {
        isLoggedIn: !!apiInstance,
        hasValidCookies: !!(cookieMetadata && validateCookies(cookieMetadata.cookies)),
        cookieAge: cookieMetadata ? Math.round((Date.now() - cookieMetadata.timestamp) / (60 * 60 * 1000)) : undefined,
        userId: cookieMetadata?.userId,
        loginMethod: cookieMetadata?.loginMethod
    };
}

// Export default
export default { login, onMessage, sendMessage };
