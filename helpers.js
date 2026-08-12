export function parseJSON(str) {
    // Ensure the input is a non-empty string first
    if (typeof str !== 'string' || !str.trim()) {
        return null;
    }

    try {
        const parsed = JSON.parse(str);

        // Ensure the output is a structured object or array, not a primitive
        return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch (e) {
        return null;
    }
}