import { assertDeploymentEnabled, validateDeploymentEnvironment } from "@/lib/deployment-environment";

export function register() {
  assertDeploymentEnabled(validateDeploymentEnvironment(process.env).mode);
}
