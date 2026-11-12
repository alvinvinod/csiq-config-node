export enum AttributeType {
  None = 0,
  Boolean = 1,
  Bit = 2,
  String = 3,
  Number = 4,
  Date = 5,
  Json = 6,
}

export enum OverrideLevel {
  None = 0,
  VoiceStack = 1,
  Practice = 2,
  LocationGroup = 3,
  Location = 4,
  User = 5,
  /** @deprecated Use LocationGroup */
  Region = 3,
}

export enum ConfigDefinitionScope {
  Client = 1,
  Server = 2,
  ClientAndServer = 3,
}

export enum AttributeArea {
  None = 0,
  Crm = 1,
  CallIntelligence = 2,
  Telephony = 3,
  Product = 4,
}

/** Optional override-layer ids. Omitted fields are not sent; the service picks the winner. */
export type ConditionOptions = {
  userId?: number;
  locationId?: number;
  locationGroupId?: number;
  attributeArea?: number;
  configDefinitionScope?: ConfigDefinitionScope;
};

/** Result of getAll(). Toggles include synthesized false; configs omit missing names. */
export type ToggleSet = {
  toggles: Record<string, boolean>;
  configurations: Record<string, unknown>;
};

/** One stored or resolved row: name, override layer (`priority`), type, and decoded value. */
export type ConfigurationDetails = {
  name: string;
  priority: number;
  type: number;
  value: unknown;
  accountId: number | null;
  userId: number | null;
  locationGroupId: number | null;
  locationId: number | null;
};

/** Optional logger for retry attempts. First-attempt success is silent. */
export type Logger = {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
};
