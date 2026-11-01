import type { CiInstallation } from "@devdigest/shared";

/** Installations that need "Update CI config". */
export function outOfDate(installations: CiInstallation[]): CiInstallation[] {
  return installations.filter((i) => i.out_of_date);
}
