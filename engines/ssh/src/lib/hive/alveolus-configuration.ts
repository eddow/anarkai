import { reactive } from 'mutts'
import type { AlveolusType } from 'ssh/src/lib/types/base'

/**
 * Type guard to check if a configuration is a storage configuration
 */
export function isSpecificStorageConfiguration(
	config: Ssh.AlveolusConfiguration,
): config is Ssh.SpecificStorageAlveolusConfiguration {
	return 'buffers' in config
}

/**
 * Global manager for named configurations.
 * Named configurations are shared across all hives.
 */
@reactive
export class AlveolusConfigurationManager {
	/** Named configurations by alveolus type, then by name */
	private namedConfigurations = new Map<AlveolusType, Map<string, Ssh.AlveolusConfiguration>>()

	/**
	 * Get a named configuration for an alveolus type
	 */
	getNamedConfiguration(
		alveolusType: AlveolusType,
		name: string,
	): Ssh.AlveolusConfiguration | undefined {
		return this.namedConfigurations.get(alveolusType)?.get(name)
	}

	/**
	 * Set a named configuration for an alveolus type
	 */
	setNamedConfiguration(
		alveolusType: AlveolusType,
		name: string,
		config: Ssh.AlveolusConfiguration,
	): void {
		if (!this.namedConfigurations.has(alveolusType)) {
			this.namedConfigurations.set(alveolusType, new Map())
		}
		this.namedConfigurations.get(alveolusType)!.set(name, config)
	}

	/**
	 * Delete a named configuration
	 */
	deleteNamedConfiguration(alveolusType: AlveolusType, name: string): boolean {
		return this.namedConfigurations.get(alveolusType)?.delete(name) ?? false
	}

	/**
	 * Get all named configurations for an alveolus type
	 */
	getNamedConfigurations(alveolusType: AlveolusType): Map<string, Ssh.AlveolusConfiguration> {
		return this.namedConfigurations.get(alveolusType) ?? new Map()
	}

	/**
	 * Serialize all named configurations for save
	 */
	serialize(): Record<AlveolusType, Record<string, Ssh.AlveolusConfiguration>> {
		const result: Record<string, Record<string, Ssh.AlveolusConfiguration>> = {}
		for (const [type, configs] of this.namedConfigurations) {
			result[type] = Object.fromEntries(configs)
		}
		return result as Record<AlveolusType, Record<string, Ssh.AlveolusConfiguration>>
	}

	/**
	 * Deserialize named configurations from save
	 */
	deserialize(data: Record<AlveolusType, Record<string, Ssh.AlveolusConfiguration>>): void {
		this.namedConfigurations.clear()
		for (const [type, configs] of Object.entries(data)) {
			const typeMap = new Map<string, Ssh.AlveolusConfiguration>()
			for (const [name, config] of Object.entries(configs)) {
				typeMap.set(name, config)
			}
			this.namedConfigurations.set(type as AlveolusType, typeMap)
		}
	}

	/**
	 * Clear all named configurations (for testing or reset)
	 */
	clear(): void {
		this.namedConfigurations.clear()
	}
}
