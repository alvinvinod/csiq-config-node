import type { ConditionOptions, ConfigurationDetails, ToggleSet } from './types';

/**
 * Read and write CareStack configuration over gRPC.
 *
 * Every method takes a CAS tenant id.
 * Callers pass casTenantId. Optional ids in
 * `options` narrow the override layer: user, location, location group,
 * attribute area. Omitted ids are not sent. Scope defaults to Server.
 *
 * The service picks the winning layer. This client does not.
 * A transport failure throws ConfigurationException. Its `code` is the gRPC status.
 */
export interface IConfigurationClient {
  /**
   * Resolved feature toggle.
   *
   * False when the toggle is off, when the definition exists but no value is stored,
   * and when the name is not a definition. Those three cases are not distinguishable here.
   * The name must be a feature toggle. Reading a config or a dev toggle through this method
   * fails the call.
   *
   * A down service throws ConfigurationException; it does not return false.
   */
  isFeatureEnabled(name: string, casTenantId: number, options?: ConditionOptions): Promise<boolean>;

  /**
   * Resolved dev toggle. Same missing-name behavior as isFeatureEnabled(): false.
   *
   * The name must be a dev toggle.
   */
  isDevToggleEnabled(name: string, casTenantId: number, options?: ConditionOptions): Promise<boolean>;

  /**
   * Resolved value for one name, or null when nothing matches.
   *
   * Null means the name is not a definition, or it is a non-toggle config with no stored value.
   * A feature or dev toggle with no stored value comes back as false, not null: the service
   * synthesizes that default.
   *
   * Decoded by the definition type: bool, int, string, or object/array.
   */
  tryGet(name: string, casTenantId: number, options?: ConditionOptions): Promise<unknown>;

  /**
   * Resolved winner for one name, including which override layer it came from.
   *
   * Throws ConfigurationException when the service reports no entry. Prefer tryGet when
   * a missing name is expected. On this service a missing name is status UNKNOWN.
   */
  getConfigurationDetails(
    name: string,
    casTenantId: number,
    options?: ConditionOptions,
  ): Promise<ConfigurationDetails>;

  /**
   * Stored rows for one name at the given override layers. Not the resolved winner.
   *
   * A toggle definition with no stored value is absent here, even though isFeatureEnabled()
   * and tryGet() report false for it.
   *
   * `overrideLevels` are OverrideLevel values.
   */
  getAllAccountConfigurations(
    name: string,
    casTenantId: number,
    overrideLevels: number[],
    options?: ConditionOptions,
  ): Promise<ConfigurationDetails[]>;

  /**
   * Resolved toggles and configurations in one RPC.
   *
   * Pass `names` for only those keys (GetAllTogglesAndConfigurationsByNames). An empty
   * list asks for every definition the service resolves for the condition
   * (GetAllTogglesAndConfigurations), including ones this app did not create.
   * Defined toggles with no stored row come back as false. Config names with no value
   * and unknown names are omitted; use `'name' in set.configurations`, not a truthiness test.
   */
  getAll(casTenantId: number, names?: string[], options?: ConditionOptions): Promise<ToggleSet>;

  /**
   * Insert or replace the value at the layer described by `options`.
   *
   * The definition must already exist. This call does not create one.
   * bool is stored as boolean, int as number, string as string, anything else as JSON.
   * A lost response can be retried, so a write may be sent more than once.
   */
  upsert(
    name: string,
    casTenantId: number,
    value: unknown,
    editedByUserId: number,
    options?: ConditionOptions,
  ): Promise<void>;

  /**
   * Remove the stored value at the layer described by `options`.
   *
   * The definition stays. A following read of a feature or dev toggle is false, the
   * synthesized default, not "missing".
   */
  delete(
    name: string,
    casTenantId: number,
    deletedByUserId: number,
    options?: ConditionOptions,
  ): Promise<void>;

  /** Close the gRPC channel. Call once on process shutdown. */
  close(): void;
}
