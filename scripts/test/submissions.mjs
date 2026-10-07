import { STACK_STATES } from './operations.mjs';
import { validDeploymentId } from './state.mjs';

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function generationCandidate(submission, stack) {
  const properties = stack?.properties;
  return stack?.tags?.submissionId === submission.id
    && properties?.parameters?.submissionId?.value === submission.id
    && guid.test(properties.correlationId ?? '')
    && properties.correlationId.toLowerCase() !== submission.previousStackCorrelationId?.toLowerCase()
    && validDeploymentId(properties.deploymentId);
}

export function generationEvidence(submission, stack, deployment) {
  if (!generationCandidate(submission, stack)) return null;
  const properties = deployment?.properties;
  const stackState = stack.properties.provisioningState?.toLowerCase();
  const deploymentState = properties?.provisioningState?.toLowerCase();
  if (deployment?.id?.toLowerCase() !== stack.properties.deploymentId.toLowerCase()
    || properties?.parameters?.submissionId?.value !== submission.id
    || !guid.test(properties.correlationId ?? '')
    || !STACK_STATES.terminal.includes(stackState)
    || !STACK_STATES.terminal.includes(deploymentState)
    || (stackState === 'succeeded' && deploymentState !== 'succeeded')) return null;
  if (deployment.id.toLowerCase() === submission.previousDeploymentId?.toLowerCase()
    && properties.correlationId.toLowerCase() === submission.previousDeploymentCorrelationId?.toLowerCase()) return null;
  return {
    result: stackState,
    evidence: {
      kind: 'deployment-generation',
      stackCorrelationId: stack.properties.correlationId,
      deploymentId: deployment.id,
      deploymentCorrelationId: properties.correlationId,
    },
  };
}
