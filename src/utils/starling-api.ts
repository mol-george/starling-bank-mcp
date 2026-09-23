// Starling Bank API configuration and utilities
import {createHash, createPrivateKey, createSign} from 'node:crypto';

export const STARLING_BANK_BASE_URL = process.env.STARLING_BANK_BASE_URL || 'https://api.starlingbank.com';

// Key information for signing requests (RSA or EC, detected from the key itself)
const {STARLING_BANK_PRIVATE_KEY_PEM, STARLING_BANK_PRIVATE_KEY_UID} = process.env;

// Signature algorithm names, keyed by asymmetricKeyType, as understood by Starling's API
const RSA_SIGNATURE_ALGORITHM = 'rsa-sha512';
const ECDSA_SIGNATURE_ALGORITHM = 'ecdsa-sha512';

// Common helper to create base headers
function createBaseHeaders(accessToken: string): Record<string, string> {
	return {
		Authorization: `Bearer ${accessToken}`,
		Accept: 'application/json',
	};
}

// Common helper to handle API errors
async function handleApiError(response: Response): Promise<never> {
	const errorText = await response.text();
	throw new Error(`Starling API error: ${response.status} ${response.statusText} - ${errorText}`);
}

// Common helper to parse response based on content type
async function parseResponse(response: Response): Promise<unknown> {
	if (!response.ok) {
		await handleApiError(response);
	}

	const contentType = response.headers.get('content-type');

	if (contentType?.includes('application/json')) {
		const responseText = await response.text();

		// Handle empty JSON responses (common for successful uploads)
		if (!responseText.trim()) {
			return {success: true, message: 'Operation completed successfully'};
		}

		try {
			return JSON.parse(responseText);
		} catch (error) {
			throw new Error(`Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	// Non-JSON responses. Mutating endpoints (e.g. spending-category / note
	// updates, deletes) reply 204 No Content with no content-type, so there is
	// no body to return. Callers validate against object output schemas, so
	// return the same success object as the empty-JSON case rather than a bare
	// string - otherwise a successful call fails schema validation and is
	// reported as an error despite the action having been applied.
	const text = await response.text();
	if (!text.trim()) {
		return {success: true, message: 'Operation completed successfully'};
	}

	return text;
}

// Determine the Signature header's algorithm value from the key type, rather
// than assuming ECDSA - uploaded keys may be RSA or EC.
function getSignatureAlgorithm(privateKeyPem: string): string {
	const {asymmetricKeyType} = createPrivateKey(privateKeyPem);

	if (asymmetricKeyType === 'rsa') {
		return RSA_SIGNATURE_ALGORITHM;
	}

	if (asymmetricKeyType === 'ec') {
		return ECDSA_SIGNATURE_ALGORITHM;
	}

	throw new Error(`Unsupported STARLING_BANK_PRIVATE_KEY_PEM key type "${asymmetricKeyType}". Expected an RSA or EC (ECDSA) private key.`);
}

// Function to create message signature for payment endpoints
function createMessageSignature(
	method: string,
	endpoint: string,
	date: string,
	digest: string,
): string {
	if (!STARLING_BANK_PRIVATE_KEY_PEM) {
		throw new Error('STARLING_BANK_PRIVATE_KEY_PEM is not set. This is an optional configuration setting, but is required to use this endpoint. Update your MCP configuration to use this endpoint, and see https://github.com/domdomegg/starling-bank-mcp for more details.');
	}

	if (!STARLING_BANK_PRIVATE_KEY_UID) {
		throw new Error('STARLING_BANK_PRIVATE_KEY_UID is not set. This is an optional configuration setting, but is required to use this endpoint. Update your MCP configuration to use this endpoint, and see https://github.com/domdomegg/starling-bank-mcp for more details.');
	}

	const contentToSign = [
		`(request-target): ${method.toLowerCase()} ${endpoint}`,
		`Date: ${date}`,
		`Digest: ${digest}`,
	].join('\n');

	const algorithm = getSignatureAlgorithm(STARLING_BANK_PRIVATE_KEY_PEM);

	const sign = createSign('SHA512');
	sign.update(contentToSign, 'utf8');
	sign.end();

	// Sign with the private key and encode as base64
	const signature = sign.sign(STARLING_BANK_PRIVATE_KEY_PEM, 'base64');

	// Return the signature header value
	return `Signature keyid="${STARLING_BANK_PRIVATE_KEY_UID}",algorithm="${algorithm}",headers="(request-target) Date Digest",signature="${signature}"`;
}

// Utility function to make authenticated API calls
export async function makeStarlingApiCall(
	endpoint: string,
	accessToken: string,
	method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
	body?: unknown,
) {
	const url = `${STARLING_BANK_BASE_URL}${endpoint}`;
	const headers = createBaseHeaders(accessToken);

	if (body) {
		headers['Content-Type'] = 'application/json';
	}

	const fetchOptions: RequestInit = {
		method,
		headers,
	};

	if (body) {
		fetchOptions.body = JSON.stringify(body);
	}

	const response = await fetch(url, fetchOptions);
	return parseResponse(response);
}

// Utility function to make signed API calls (for payment endpoints)
export async function makeSignedStarlingApiCall(
	endpoint: string,
	accessToken: string,
	method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
	body?: unknown,
) {
	const url = `${STARLING_BANK_BASE_URL}${endpoint}`;
	const headers = createBaseHeaders(accessToken);
	const requestBody = JSON.stringify(body);
	if (body) {
		headers['Content-Type'] = 'application/json';
	}

	const date = new Date().toISOString();
	headers.Date = date;

	const hash = createHash('sha512');
	hash.update(requestBody, 'utf8');
	const digest = body ? hash.digest('base64') : 'X';
	headers.Digest = digest;

	const signature = createMessageSignature(method, endpoint, date, digest);

	// Add signature to the Authorization header (not as separate header)
	headers.Authorization = `${headers.Authorization};${signature}`;

	const fetchOptions: RequestInit = {
		method,
		headers,
	};

	if (body) {
		fetchOptions.body = requestBody;
	}

	const response = await fetch(url, fetchOptions);
	return parseResponse(response);
}

// Utility function for binary file uploads
export async function makeStarlingApiCallWithBinary(
	endpoint: string,
	accessToken: string,
	binaryData: Buffer,
	contentType?: string,
) {
	const url = `${STARLING_BANK_BASE_URL}${endpoint}`;
	const headers = createBaseHeaders(accessToken);

	if (contentType) {
		headers['Content-Type'] = contentType;
	}

	const fetchOptions: RequestInit = {
		method: 'POST',
		headers,
		body: binaryData,
	};

	const response = await fetch(url, fetchOptions);
	return parseResponse(response);
}

// Utility function for binary file downloads
export async function makeStarlingApiCallForBinary(
	endpoint: string,
	accessToken: string,
): Promise<ArrayBuffer> {
	const url = `${STARLING_BANK_BASE_URL}${endpoint}`;
	const headers = createBaseHeaders(accessToken);

	const fetchOptions: RequestInit = {
		method: 'GET',
		headers,
	};

	const response = await fetch(url, fetchOptions);

	if (!response.ok) {
		await handleApiError(response);
	}

	return response.arrayBuffer();
}
