export function evaluate(response, failOn) {
  if (failOn === "never") {
    return { passed: true, reason: "Configured to never fail" };
  }

  const health = response.structural?.gauge_ready?.system_health;
  const findings = response.structural?.findings?.findings || [];

  if (failOn === "high-finding") {
    const high = findings.filter((f) => f.severity === "high");
    if (high.length > 0) {
      return {
        passed: false,
        reason: `${high.length} high-severity finding(s): ${high.map((f) => f.title).join(", ")}`,
      };
    }
    return { passed: true, reason: "No high-severity findings" };
  }

  if (!health) {
    return {
      passed: true,
      reason: "No gauge data available (Free tier does not include structured metrics for merge gating)",
      noGauge: true,
    };
  }

  if (failOn === "yellow") {
    if (health === "red" || health === "yellow") {
      return { passed: false, reason: `System health is ${health}` };
    }
    return { passed: true, reason: `System health: ${health}` };
  }

  // Default: "red"
  if (health === "red") {
    return { passed: false, reason: "System health is red" };
  }
  return { passed: true, reason: `System health: ${health}` };
}
