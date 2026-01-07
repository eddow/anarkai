import { stored } from '$lib/storage';

export interface Configuration {
	darkMode: boolean;
}

function getDefaultConfiguration(): Configuration {
	if (typeof window === 'undefined') {
		return { darkMode: false };
	}

	// Default to dark mode as per user preference/parity
	return {
		darkMode: true, // Force true for now 
	};
}

export const configuration = stored<Configuration>(getDefaultConfiguration());
