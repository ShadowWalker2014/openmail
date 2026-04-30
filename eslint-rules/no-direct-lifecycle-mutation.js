/**
 * Custom ESLint rule: no-direct-lifecycle-mutation
 *
 * Stage 2 — REQ-12, CR-02, [V2.11 ambiguity-4].
 *
 * Flags direct Drizzle status mutations on `campaigns` or `campaignEnrollments`
 * outside the audited helper. The pattern looks like:
 *
 *   db.update(campaigns).set({ status: "paused" })
 *   tx.update(campaignEnrollments).set({ status: "completed", … })
 *
 * Detection (AST):
 *   CallExpression
 *     callee = MemberExpression
 *       object  = CallExpression
 *         callee = MemberExpression
 *           object  = Identifier      ← `db`/`tx`/`trx`/`transaction`
 *           property = "update"
 *         arguments[0] = Identifier   ← `campaigns`/`campaignEnrollments`
 *       property = "set"
 *     arguments[0] = ObjectExpression with a `status` key
 *
 * Allowlist (file paths):
 *   - **\/*.test.{ts,js}        — tests can fixture raw mutations
 *   - **\/migrations/*          — migrations bypass via auditedMigration helper
 *   - **\/scripts/seed*.{ts,js} — seed data fixtures
 *   - **\/lib/commit-lifecycle-status.{ts,js}  — the helper itself
 *   - **\/lib/audited-migration.{ts,js}        — audited migration wrapper
 *   - **\/db/lib/**                            — shared DB lib internals
 *
 * Project-state note (Round 2 deferral):
 *   At the time this rule was authored (Stage 2 Round 2, 2026-04-30) the
 *   OpenMail repo did NOT have ESLint installed. Registration of this rule
 *   is deferred until the project adds ESLint at the workspace root. The
 *   rule file is delivered now so it can be wired up immediately when ESLint
 *   lands. To register:
 *
 *     // eslint.config.js (flat config)
 *     import noDirectLifecycleMutation from "./eslint-rules/no-direct-lifecycle-mutation.js";
 *
 *     export default [
 *       {
 *         plugins: {
 *           lifecycle: { rules: { "no-direct-lifecycle-mutation": noDirectLifecycleMutation } },
 *         },
 *         rules: { "lifecycle/no-direct-lifecycle-mutation": "error" },
 *         ignores: [
 *           "**\/*.test.ts", "**\/*.test.js",
 *           "**\/migrations/**", "**\/scripts/seed*.{ts,js}",
 *           "**\/lib/commit-lifecycle-status.{ts,js}",
 *           "**\/lib/audited-migration.{ts,js}",
 *           "**\/db/lib/**",
 *         ],
 *       },
 *     ];
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid direct Drizzle status mutations on campaigns / campaign_enrollments outside the audited helper",
      recommended: true,
    },
    schema: [],
    messages: {
      forbidden:
        "Direct status mutation forbidden. Use commitLifecycleStatus() helper to ensure audit emission. See PRP Stage 2 [REQ-12].",
    },
  },

  create(context) {
    const TRANSACTION_IDENTIFIERS = new Set(["db", "tx", "trx", "transaction"]);
    const LIFECYCLE_TABLES = new Set(["campaigns", "campaignEnrollments"]);

    /** Returns true if the call expression matches `<id>.update(<table>)`. */
    function isUpdateCallOnLifecycleTable(node) {
      if (!node || node.type !== "CallExpression") return false;
      const callee = node.callee;
      if (
        !callee ||
        callee.type !== "MemberExpression" ||
        callee.property.type !== "Identifier" ||
        callee.property.name !== "update"
      ) {
        return false;
      }
      const obj = callee.object;
      if (!obj || obj.type !== "Identifier") return false;
      if (!TRANSACTION_IDENTIFIERS.has(obj.name)) return false;
      const arg = node.arguments[0];
      if (!arg || arg.type !== "Identifier") return false;
      return LIFECYCLE_TABLES.has(arg.name);
    }

    /** Returns true when the .set() arg is an object literal with a `status` key. */
    function setArgHasStatusKey(setCallNode) {
      const arg = setCallNode.arguments[0];
      if (!arg || arg.type !== "ObjectExpression") return false;
      return arg.properties.some(
        (p) =>
          p.type === "Property" &&
          ((p.key.type === "Identifier" && p.key.name === "status") ||
            (p.key.type === "Literal" && p.key.value === "status")),
      );
    }

    return {
      // Match the outer CallExpression — the .set(...) call.
      CallExpression(node) {
        const callee = node.callee;
        if (
          !callee ||
          callee.type !== "MemberExpression" ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "set"
        ) {
          return;
        }
        // .set() must be chained on a `<id>.update(<lifecycleTable>)` call.
        if (!isUpdateCallOnLifecycleTable(callee.object)) return;
        if (!setArgHasStatusKey(node)) return;
        context.report({ node, messageId: "forbidden" });
      },
    };
  },
};

export default rule;
