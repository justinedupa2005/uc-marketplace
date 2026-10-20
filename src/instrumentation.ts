import { validateDeploymentEnvironment } from "@/lib/deployment-environment";

export function register() {
  validateDeploymentEnvironment(process.env);
}
