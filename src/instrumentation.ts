import { assertDeploymentEnabled, validateDeploymentEnvironment } from "@/lib/deployment-environment";
import type { Instrumentation } from "next";
import { reportOperationalEvent, routeGroup } from "@/lib/observability/events";

export function register() {
  assertDeploymentEnabled(validateDeploymentEnvironment(process.env).mode);
}

export const onRequestError: Instrumentation.onRequestError = (_error, request, context) => {
  reportOperationalEvent("server_exception", { route: routeGroup(context.routePath), method: request.method });
};
