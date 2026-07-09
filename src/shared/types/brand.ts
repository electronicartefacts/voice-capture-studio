export type Brand<TValue, TBrand extends string> = TValue & {
  readonly __brand: TBrand;
};

export type IsoDateTime = Brand<string, "IsoDateTime">;
export type Semver = Brand<string, "Semver">;
