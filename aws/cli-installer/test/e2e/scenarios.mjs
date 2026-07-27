/**
 * E2E scenario matrix + CLI argument construction.
 *
 * These functions are PURE (no AWS, no I/O) so they can be unit-tested without
 * credentials. The live runner (run.mjs) turns each scenario into a real CLI
 * invocation, verifies data flow, then tears the stack down.
 *
 * The matrix covers the two dimensions called out for AWS-specific coverage:
 *   - network topology: public endpoints vs. VPC-private endpoints
 *   - demo workload:    launch the EC2 OTel-demo instance vs. skip it
 * plus the managed-domain vs. serverless backend split.
 */

/**
 * The default scenario matrix. `enabledByDefault` scenarios run in a plain
 * `run.mjs` invocation; the rest are opt-in (they cost more time/money or need
 * extra inputs such as a VPC). A developer can also select scenarios by name.
 *
 * VPC scenarios require --vpc-id/--subnet-ids/--security-group-ids, supplied via
 * env (see envToVpc). They are opt-in because they need pre-existing VPC infra.
 */
export const SCENARIOS = [
  {
    name: 'managed-public-demo',
    description: 'Managed domain, public endpoints, EC2 OTel-demo launched',
    backend: 'managed',
    vpc: false,
    demo: true,
    enabledByDefault: true,
    verifyDataFlow: true,
  },
  {
    name: 'managed-public-nodemo',
    description: 'Managed domain, public endpoints, no demo (synthetic OTLP push)',
    backend: 'managed',
    vpc: false,
    demo: false,
    enabledByDefault: true,
    verifyDataFlow: true,
  },
  {
    name: 'serverless-public-nodemo',
    description: 'Serverless (AOSS) collection, public endpoints, synthetic OTLP push',
    backend: 'serverless',
    vpc: false,
    demo: false,
    enabledByDefault: true,
    verifyDataFlow: true,
  },
  {
    name: 'managed-vpc-demo',
    description: 'Managed domain in a VPC (private endpoints), EC2 OTel-demo launched',
    backend: 'managed',
    vpc: true,
    demo: true,
    enabledByDefault: false,
    // The EC2 demo launches INSIDE the configured VPC (see ec2-demo.mjs), so it
    // can reach the VPC-private OSIS ingest endpoint. This is the scenario that
    // actually proves end-to-end VPC data flow; verification queries the domain
    // through the reachable-from-outside Application (OpenSearch UI) endpoint.
    verifyDataFlow: true,
  },
  {
    name: 'managed-vpc-nodemo',
    description: 'Managed domain in a VPC (private endpoints), no demo — create/destroy only',
    backend: 'managed',
    vpc: true,
    demo: false,
    enabledByDefault: false,
    // A VPC-attached OSIS pipeline exposes a VPC-PRIVATE ingest endpoint (resolves
    // to RFC-1918 addresses reachable only inside the VPC). The synthetic OTLP push
    // originates from the developer's host, which has no route into the VPC, so it
    // can never reach that endpoint — data-flow verification is not applicable here.
    // This scenario therefore exercises create + the full teardown path only (the
    // CLI still proves the VPC-attached pipeline reaches ACTIVE before exiting 0).
    // Use managed-vpc-demo to verify actual VPC data flow (demo runs in-VPC).
    verifyDataFlow: false,
  },
];

/**
 * Look up a scenario by name. Throws with the list of valid names if unknown.
 */
export function getScenario(name) {
  const s = SCENARIOS.find((x) => x.name === name);
  if (!s) {
    throw new Error(`Unknown scenario '${name}'. Valid: ${SCENARIOS.map((x) => x.name).join(', ')}`);
  }
  return s;
}

/**
 * Select the scenarios to run.
 *   - names: explicit list (highest precedence)
 *   - all:   include opt-in scenarios too
 *   - otherwise: the default-enabled scenarios
 */
export function selectScenarios({ names, all } = {}) {
  if (names?.length) return names.map(getScenario);
  if (all) return [...SCENARIOS];
  return SCENARIOS.filter((s) => s.enabledByDefault);
}

/**
 * Derive VPC parameters from the environment. VPC scenarios are skipped (not
 * failed) when these are absent, so the default matrix stays runnable anywhere.
 * Returns { vpcId, subnetIds, securityGroupIds } or null when unset.
 */
export function envToVpc(env = process.env) {
  const vpcId = env.E2E_VPC_ID || '';
  const subnetIds = (env.E2E_SUBNET_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const securityGroupIds = (env.E2E_SECURITY_GROUP_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!vpcId || !subnetIds.length || !securityGroupIds.length) return null;
  return { vpcId, subnetIds, securityGroupIds };
}

/**
 * Build a unique, DNS/OSIS-safe pipeline name for a scenario run.
 * OSIS caps pipeline names at 28 chars, lowercase-alnum-hyphen, letter-first.
 * `suffix` is typically a short timestamp/run id to avoid collisions.
 */
export function buildPipelineName(scenario, suffix) {
  // Short, stable tag per scenario so the name stays within 28 chars.
  const tagByName = {
    'managed-public-demo': 'mpd',
    'managed-public-nodemo': 'mpn',
    'serverless-public-nodemo': 'spn',
    'managed-vpc-demo': 'mvd',
    'managed-vpc-nodemo': 'mvn',
  };
  const tag = tagByName[scenario.name] || scenario.name.replace(/[^a-z0-9]/g, '').slice(0, 6);
  const raw = `e2e-${tag}-${suffix}`.toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9-]/g, '').replace(/^-+/, '').slice(0, 28);
  // Guarantee it starts with a letter (OSIS requirement).
  return /^[a-z]/.test(cleaned) ? cleaned : `e${cleaned}`.slice(0, 28);
}

/**
 * Build the argv (after `node cli-installer.mjs`) for creating a scenario's stack.
 *
 * @param {object} scenario  one of SCENARIOS
 * @param {object} opts
 * @param {string} opts.pipelineName
 * @param {string} opts.region
 * @param {object|null} [opts.vpc]  { vpcId, subnetIds[], securityGroupIds[] } — required if scenario.vpc
 * @returns {string[]} argv
 */
export function buildCreateArgs(scenario, opts) {
  const { pipelineName, region, vpc } = opts;
  if (!pipelineName) throw new Error('buildCreateArgs: pipelineName is required');
  if (!region) throw new Error('buildCreateArgs: region is required');

  // Quick mode (the default — no --advanced) is what we want here: it auto-creates
  // the whole stack (IAM OSI role, APS workspace, Application) named after the
  // pipeline, while still honoring every explicit flag we pass below. Advanced mode
  // only creates the resources you name explicitly, so passing --advanced with just
  // --os-domain-name would create the domain but skip the OSI role, leaving OSIS to
  // reject an empty PipelineRoleArn ("Cross-account pass role is not allowed"). The
  // e2e always creates fresh resources, so quick mode is the correct, realistic path.
  const args = ['--pipeline-name', pipelineName, '--region', region];

  if (scenario.backend === 'serverless') {
    args.push('--serverless', '--aoss-collection-name', pipelineName);
  } else {
    args.push('--managed', '--os-domain-name', pipelineName);
  }

  if (scenario.vpc) {
    if (!vpc?.vpcId || !vpc.subnetIds?.length || !vpc.securityGroupIds?.length) {
      throw new Error(`buildCreateArgs: scenario '${scenario.name}' requires vpc {vpcId, subnetIds, securityGroupIds}`);
    }
    args.push(
      '--vpc-id', vpc.vpcId,
      '--subnet-ids', vpc.subnetIds.join(','),
      '--security-group-ids', vpc.securityGroupIds.join(','),
    );
  }

  if (!scenario.demo) args.push('--skip-demo');

  return args;
}

/**
 * Build the argv for tearing a scenario's stack down.
 */
export function buildDestroyArgs(scenario, opts) {
  const { pipelineName, region } = opts;
  const args = ['destroy', '--pipeline-name', pipelineName, '--region', region];
  if (scenario.backend === 'serverless') args.push('--aoss-collection-name', pipelineName);
  return args;
}
