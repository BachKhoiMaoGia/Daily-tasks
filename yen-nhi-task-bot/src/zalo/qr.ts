/**
 * zalo/qr.ts
 * QR Code management for web display on server environments like Render
 */
import fs from 'fs';
import path from 'path';

interface QRData {
    url?: string;
    base64?: string;
    timestamp: number;
}

let currentQR: QRData | null = null;

/**
 * Store QR data for web display
 */
export function storeQRData(qrData: any) {
    console.log('[QR DEBUG] Received qrData:', JSON.stringify(qrData, null, 2));

    if (qrData) {
        // Store QR data with proper base64 format - handle both old and new zca-js formats
        currentQR = {
            url: qrData.token || qrData.code || qrData.url,  // Handle different property names
            base64: qrData.image,  // Store raw base64 without data:image prefix
            timestamp: Date.now()
        };

        console.log('[QR] ✅ QR data stored:', {
            hasUrl: !!currentQR.url,
            hasBase64: !!currentQR.base64,
            base64Length: currentQR.base64 ? currentQR.base64.length : 0,
            timestamp: new Date(currentQR.timestamp).toISOString(),
            originalKeys: Object.keys(qrData)
        });

        // Also save base64 as image file if available
        if (qrData.image) {
            try {
                const qrPath = path.join(process.cwd(), 'qr.png');
                fs.writeFileSync(qrPath, Buffer.from(qrData.image, 'base64'));
                console.log('[QR] ✅ Saved QR code to qr.png');
            } catch (err) {
                console.error('[QR] ❌ Error saving QR image:', err);
            }
        }
    }
}

/**
 * Get current QR data
 */
export function getCurrentQR(): QRData | null {
    // QR codes expire after 8 minutes (extended for slower networks)
    if (currentQR && (Date.now() - currentQR.timestamp) > 8 * 60 * 1000) {
        console.log('[QR] QR code expired, clearing...');
        currentQR = null;
    }

    if (currentQR) {
        const age = Math.round((Date.now() - currentQR.timestamp) / 1000);
        console.log(`[QR] Current QR age: ${age}s, hasBase64: ${!!currentQR.base64}, hasUrl: ${!!currentQR.url}`);
    }

    return currentQR;
}

/**
 * Clear QR data (when login successful)
 */
export function clearQR() {
    currentQR = null;
    // Remove qr.png file
    try {
        const qrPath = path.join(process.cwd(), 'qr.png');
        if (fs.existsSync(qrPath)) {
            fs.unlinkSync(qrPath);
            console.log('[QR] Removed qr.png file');
        }
    } catch (err) {
        console.error('[QR] Error removing QR file:', err);
    }
}
