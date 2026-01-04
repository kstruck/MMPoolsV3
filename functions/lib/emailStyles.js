"use strict";
// Shared email styles matching the frontend Service (Light Theme)
// Based on src/services/emailService.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderEmailHtml = exports.STYLES = exports.LOGO_URL = exports.BASE_URL = void 0;
exports.BASE_URL = "https://www.marchmeleepools.com";
exports.LOGO_URL = `${exports.BASE_URL}/email-logo.png`;
exports.STYLES = {
    container: "font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #334155; line-height: 1.6;",
    header: "text-align: center; margin-bottom: 30px; padding: 20px; background-color: #0f172a; border-radius: 0 0 12px 12px;",
    logo: "height: 50px; width: auto;",
    h1: "color: #0f172a; font-size: 24px; margin-bottom: 10px;",
    p: "font-size: 16px; margin-bottom: 20px;",
    footer: "margin-top: 30px; font-size: 14px; color: #94a3b8; text-align: center;",
    button: "background-color: #4f46e5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;",
    buttonContainer: "margin-top: 30px; text-align: center;"
};
const renderEmailHtml = (title, bodyContent, ctaLink, ctaText) => {
    const buttonHtml = ctaLink ? `
        <div style="${exports.STYLES.buttonContainer}">
            <a href="${ctaLink}" style="${exports.STYLES.button}">${ctaText || 'View Pool'}</a>
        </div>
    ` : '';
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff;">
    <div style="${exports.STYLES.container}">
        <div style="${exports.STYLES.header}">
            <img src="${exports.LOGO_URL}" alt="March Melee Pools" style="${exports.STYLES.logo}" />
        </div>
        
        <div style="padding: 0 20px;">
            <h1 style="${exports.STYLES.h1}">${title}</h1>
            
            ${bodyContent}
            
            ${buttonHtml}
            
            <p style="${exports.STYLES.footer}">
                Good luck!<br>
                <a href="${exports.BASE_URL}" style="color: #94a3b8; text-decoration: none; font-size: 12px; margin-top: 10px; display: inline-block;">Sent by March Melee Pools</a>
            </p>
            
            <hr style="border: 1px solid #eee; margin: 20px 0;" />
            <p style="font-size: 12px; color: #666; text-align: center;">
                Want to create and host your own pool? Go to <a href="${exports.BASE_URL}" style="color: #4f46e5;">MarchMeleePools.com</a> and create a pool for your office, friends, or favorite charity today!
            </p>
        </div>
    </div>
</body>
</html>
    `.trim();
};
exports.renderEmailHtml = renderEmailHtml;
//# sourceMappingURL=emailStyles.js.map