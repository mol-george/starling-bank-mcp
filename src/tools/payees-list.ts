import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {Config} from './types.js';
import {makeStarlingApiCall} from '../utils/starling-api.js';
import {jsonResult} from '../utils/response.js';

// Starling returns absent optional fields as null, not omitted, so nullish() rather than optional().
const payeeAccount = z.object({
	payeeAccountUid: z.string().nullish(),
	payeeChannelType: z.string().nullish(),
	description: z.string().nullish(),
	defaultAccount: z.boolean().nullish(),
	countryCode: z.string().nullish(),
	accountIdentifier: z.string().nullish(),
	bankIdentifier: z.string().nullish(),
	bankIdentifierType: z.string().nullish(),
	secondaryIdentifier: z.string().nullish(),
	lastReferences: z.array(z.string()).nullish(),
});

const payee = z.object({
	payeeUid: z.string(),
	payeeName: z.string(),
	phoneNumber: z.string().nullish(),
	payeeType: z.string(),
	firstName: z.string().nullish(),
	middleName: z.string().nullish(),
	lastName: z.string().nullish(),
	businessName: z.string().nullish(),
	dateOfBirth: z.string().nullish(),
	accounts: z.array(payeeAccount).nullish(),
});

const outputSchema = z.object({
	payees: z.array(payee),
});

export function registerPayeesList(server: McpServer, config: Config): void {
	server.registerTool(
		'payees_list',
		{
			title: 'List all payees',
			description: 'Get all payees (people/companies you can send payments to) for the account holder.',
			inputSchema: {},
			outputSchema,
			annotations: {
				readOnlyHint: true,
			},
		},
		async () => {
			const result = await makeStarlingApiCall('/api/v2/payees', config.accessToken);
			return jsonResult(outputSchema.parse(result));
		},
	);
}
