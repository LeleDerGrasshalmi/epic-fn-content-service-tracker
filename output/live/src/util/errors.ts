/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */

function checkForAuthError(errorCode: string): void {
    if (errorCode === "errors.com.epicgames.common.oauth.invalid_token" || errorCode.endsWith(".auth_required")) {
        location.href = "/oauth/v1/login?fwd="+encodeURIComponent(location.href);
    }
}

export function parseErrorMessage(e: any): string {
    if (e.errorCode && e.errorMessage) {
        // EPIC ERROR OBJECT
        console.error(e);
        checkForAuthError(e.errorCode);
        return `${e.errorMessage} <code>${e.errorCode}</code>`;
    } else if (e.responseJSON) {
        // JQUERY
        const json = e.responseJSON;
        console.error(e);
        checkForAuthError(json.errorCode);
        return `${json.errorMessage} <code>${json.errorCode}</code>`;
    } else if (e.errorCode) {
        checkForAuthError(e.errorCode);
        return `${e.errorMessage} <code>${e.errorCode}</code>`;
    } else if (e.statusText) {
        console.error(e.statusText);
        let result = e.statusText;

        if (e.status === 0)
            result = `${result} - network_error(0)`;
        else if (typeof e.status === "number")
            result = `${result} - status (${e.status})`;

        return result as string;
    } else if (e.message) {
        console.error(e.message);
        if (e.message === "TypeError: Failed to fetch")
            return "Unable to connect to the server."; // NOTE: this can be connection error or CORS headers missing
        return e.message as string;
    } else if (typeof e === "string") {
        return e;
    } else {
        console.error(e);
        return JSON.stringify(e, null, 2);
    }
}