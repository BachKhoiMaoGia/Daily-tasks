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
    if (qrData) {
        currentQR = {
            url: qrData.url,
            base64: qrData.base64,
            timestamp: Date.now()
        };

        // Also save base64 as image file if available
        if (qrData.base64) {
            try {
                const base64Data = qrData.base64.replace(/^data:image\/png;base64,/, '');
                const qrPath = path.join(process.cwd(), 'qr.png');
                fs.writeFileSync(qrPath, Buffer.from(base64Data, 'base64'));
                console.log('[QR] Saved QR code to qr.png');
            } catch (err) {
                console.error('[QR] Error saving QR image:', err);
            }
        }
    }
}

/**
 * Get current QR data
 */
export function getCurrentQR(): QRData | null {
    // QR codes expire after 5 minutes
    if (currentQR && (Date.now() - currentQR.timestamp) > 5 * 60 * 1000) {
        currentQR = null;
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
