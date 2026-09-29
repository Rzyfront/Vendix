import { Injectable, Logger } from '@nestjs/common';
import { AIToolDefinition } from '../interfaces/ai-provider.interface';
import {
  DEFAULT_TOOL_VERSION,
  RegisteredTool,
  ToolExecutionContext,
} from './interfaces/tool.interface';
import { VendixHttpException, ErrorCodes } from '../../common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { VexiConfirmationService } from '../../domains/store/vexi/vexi-confirmation.service';
import { validateToolArgs } from './tool-args.validator';

@Injectable()
export class AIToolRegistry {
  private readonly logger = new Logger(AIToolRegistry.name);
  private tools = new Map<string, RegisteredTool>();
  /**
   * T2: `oldName → newName`. Todo breaking crea una versión nueva del tool y
   * registra aquí el nombre viejo durante el sunset, para que los turnos
   * persistidos en `ai_messages.tool_calls` sigan resolviendo. El alias
   * sobrevive a la remoción del handler (T5).
   */
  private aliases = new Map<string, string>();

  constructor(private readonly confirmations: VexiConfirmationService) {}

  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool "${tool.name}" is being overwritten`);
    }
    tool.version ??= DEFAULT_TOOL_VERSION;
    this.tools.set(tool.name, tool);
    this.logger.log(
      `Registered tool: ${tool.name} (${tool.domain}) v${tool.version}`,
    );
  }

  /**
   * Registra `oldName` como alias de `newName` durante una ventana de sunset.
   * No valida que el destino exista todavía: el alias puede registrarse antes
   * que la versión nueva, y un destino ausente cae al camino de nombre
   * desconocido con sugerencias (`suggestToolNames`) en vez de resolver mal.
   */
  registerAlias(oldName: string, newName: string): void {
    if (oldName === newName) {
      this.logger.warn(`Alias "${oldName}" points to itself; ignored`);
      return;
    }
    this.aliases.set(oldName, newName);
    this.logger.log(`Registered tool alias: ${oldName} → ${newName}`);
  }

  /**
   * Entry point for decentralized registration: a domain module calls this
   * from its own `onModuleInit` with its own services already injected.
   *
   * The inverse — `AIEngineModule` importing one module per tool-owning
   * domain — cannot scale: that module is `@Global()`, so every such import
   * is a candidate dependency cycle, and there are ~60 domains still to wire.
   * Inverting the direction means a new family costs one `onModuleInit` in
   * the domain that owns the data and zero edits here.
   */
  registerMany(tools: RegisteredTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  getAll(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  getToolsForDomain(domain: string): AIToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => t.domain === domain)
      .map((t) => this.toDefinition(t));
  }

  getAllDefinitions(): AIToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => this.toDefinition(t));
  }

  getAvailableDefinitions(userPermissions?: string[]): AIToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => this.isPermitted(t, userPermissions))
      .map((t) => this.toDefinition(t));
  }

  /**
   * Permission-filtered catalog restricted to side-effect-free tools.
   * Used by surfaces that execute without a confirmation step (realtime
   * voice). Fail-closed: a tool that does not declare `readOnly: true` is
   * excluded even if the user holds every permission it requires.
   */
  getReadOnlyDefinitions(userPermissions?: string[]): AIToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => t.readOnly === true && this.isPermitted(t, userPermissions))
      .map((t) => this.toDefinition(t));
  }

  /**
   * Tools the browser executes. Published to every surface — including voice,
   * where navigating by speech is the whole point — but never executed here.
   */
  getClientSideDefinitions(userPermissions?: string[]): AIToolDefinition[] {
    return Array.from(this.tools.values())
      .filter(
        (t) => t.clientSide === true && this.isPermitted(t, userPermissions),
      )
      .map((t) => this.toDefinition(t));
  }

  // Both resolve through `resolveToolName` for the same reason `executeTool`
  // does: a provider-namespaced name must reach the same flags as the bare one.
  // Without it, `isClientSide('default_api.ui_navigate')` is false and the
  // agent tries to run a browser command on the server. Still fail-closed — the
  // answer comes from the resolved tool's own flag, never from a default.
  isReadOnly(name: string): boolean {
    const resolved = this.resolveToolName(name);
    return resolved ? this.tools.get(resolved)?.readOnly === true : false;
  }

  isClientSide(name: string): boolean {
    const resolved = this.resolveToolName(name);
    return resolved ? this.tools.get(resolved)?.clientSide === true : false;
  }

  private isPermitted(
    tool: RegisteredTool,
    userPermissions?: string[],
  ): boolean {
    if (!tool.requiredPermissions?.length) return true;
    if (!userPermissions) return false;
    return tool.requiredPermissions.every((p) => userPermissions.includes(p));
  }

  /**
   * The registered name behind what the provider actually sent.
   *
   * Gemini namespaces function calls (`default_api.update_product_price`), so
   * an exact-match lookup rejects a call that named the right tool. The suffix
   * after the last dot is tried before giving up, which recovers those without
   * loosening the match for anything else: dots are not legal in tool names.
   */
  /**
   * The name to use everywhere downstream: the registered one when it resolves,
   * and otherwise whatever the provider sent, so an unknown tool still reports
   * the name the model actually used.
   */
  canonicalName(name: string): string {
    return this.resolveToolName(name) ?? name;
  }

  /**
   * Versión del contrato del tool ya resuelto, para el catálogo MCP y el
   * envelope de salida. Fuera del registry para no contaminar el schema
   * `AIToolDefinition` que viaja a los proveedores con una clave extra que
   * sus APIs estrictas rechazarían.
   */
  getToolVersion(name: string): string {
    const resolved = this.resolveToolName(name);
    const tool = resolved ? this.tools.get(resolved) : undefined;
    return tool?.version ?? DEFAULT_TOOL_VERSION;
  }

  private resolveToolName(name: string): string | null {
    if (this.tools.has(name)) return name;

    const withoutNamespace = name.includes('.')
      ? name.slice(name.lastIndexOf('.') + 1)
      : null;

    if (withoutNamespace && this.tools.has(withoutNamespace)) {
      return withoutNamespace;
    }

    // T2: alias explícitos `oldName → newName`, con guarda anti-ciclos. Solo
    // los alias registrados redirigen: una resolución difusa aquí (reusar
    // `suggestToolNames` para adivinar) ejecutaría un tool que el modelo no
    // nombró, así que lo desconocido sigue lanzando AI_AGENT_003 con
    // sugerencias para que el loop se corrija en el turno siguiente.
    const seen = new Set<string>([name]);
    let candidate: string | undefined = this.aliases.get(
      withoutNamespace ?? name,
    );
    while (candidate) {
      if (this.tools.has(candidate)) return candidate;
      if (seen.has(candidate)) return null;
      seen.add(candidate);
      candidate = this.aliases.get(candidate);
    }

    return null;
  }

  /**
   * Real tool names closest to one the model made up.
   *
   * Scored by shared `snake_case` segments rather than edit distance: the
   * hallucinations seen in practice are prefix/suffix inventions over real
   * vocabulary (`ui_find_product` for `find_product`, `get_orders_list` for
   * `list_orders`), which segment overlap catches and character distance
   * mostly does not.
   */
  private suggestToolNames(name: string, limit = 4): string[] {
    const wanted = new Set(name.split('_').filter(Boolean));
    if (!wanted.size) return [];

    return [...this.tools.keys()]
      .map((candidate) => {
        const parts = candidate.split('_').filter(Boolean);
        const shared = parts.filter((part) => wanted.has(part)).length;
        return { candidate, shared };
      })
      .filter((entry) => entry.shared > 0)
      .sort(
        (a, b) =>
          b.shared - a.shared || a.candidate.length - b.candidate.length,
      )
      .slice(0, limit)
      .map((entry) => entry.candidate);
  }

  /**
   * The single choke point for every tool execution in the product: the agent
   * loop, the realtime voice bridge and the MCP provider all land here. The
   * confirmation gate lives at this level for exactly that reason — putting it
   * in the agent loop would leave the other two unprotected and would have to
   * be re-implemented for every surface added later.
   */
  async executeTool(
    name: string,
    args: Record<string, any>,
    options?: { confirmationToken?: string },
  ): Promise<string> {
    const resolvedName = this.resolveToolName(name);
    const tool = resolvedName ? this.tools.get(resolvedName) : undefined;
    if (!tool) {
      // A bare "not found" ends the turn: the model has no way to recover and
      // tells the user the record does not exist, when what happened is that
      // it invented a tool name. Handing back the closest real names lets the
      // loop correct itself on the next iteration instead of giving up.
      const suggestions = this.suggestToolNames(name);
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_003,
        suggestions.length
          ? `La herramienta "${name}" no existe. Las que más se le parecen: ${suggestions.join(', ')}. Vuelve a intentarlo con una de esas.`
          : `La herramienta "${name}" no existe. Revisa el catálogo antes de volver a llamarla.`,
      );
    }

    // Loud failure on purpose. A client that does not know how to dispatch a
    // UI command must find out here, not receive an empty `200` that the
    // model then narrates as a completed action the user never saw happen.
    if (tool.clientSide) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_003,
        `Tool "${name}" is a client-side UI command and cannot be executed on the server. It must be dispatched by the browser.`,
      );
    }

    const requestContext = RequestContextService.getContext();
    const context: ToolExecutionContext = {
      organization_id: requestContext?.organization_id,
      store_id: requestContext?.store_id,
      user_id: requestContext?.user_id,
      roles: requestContext?.roles,
    };

    // Check permissions — use granular permissions if available, fall back to roles
    if (tool.requiredPermissions?.length) {
      // `[]` is truthy, so `permissions || roles` never reaches the fallback
      // for a user whose permission list resolved empty. Check length.
      const granted = requestContext?.permissions;
      const userPermissions = granted?.length ? granted : (context.roles ?? []);
      const hasPermission = tool.requiredPermissions.every((p) =>
        userPermissions.includes(p),
      );
      if (!hasPermission) {
        throw new VendixHttpException(
          ErrorCodes.AI_AGENT_004,
          `Insufficient permissions for tool "${name}"`,
        );
      }
    }

    // Validación en el borde (T3): ningún `preview` ni `handler` ejecuta con
    // args inválidos. Va DESPUÉS del permiso para no filtrar el schema a quien
    // no puede usar el tool, y ANTES de la confirmación para no acuñar un
    // token sobre basura. El fallo NO lanza: devuelve `{error, next_step}` en
    // español, la misma doctrina de los handlers — un `AI_AGENT_003` opaco no
    // le dice al modelo qué corregir.
    const edgeValidation = validateToolArgs(tool.name, tool.parameters, args);
    if (!edgeValidation.ok) {
      this.logger.warn(
        `Tool "${name}" rejected at the edge: ${edgeValidation.error}`,
      );
      return JSON.stringify({
        error: edgeValidation.error,
        next_step: edgeValidation.next_step,
      });
    }

    if (tool.requiresConfirmation) {
      await this.enforceConfirmation(
        tool,
        name,
        args,
        context,
        options?.confirmationToken,
      );
    }

    // `handler` is optional only so `clientSide` tools can omit it. Reaching
    // here without one means a server-side tool was registered incomplete —
    // a wiring bug, surfaced rather than swallowed as an empty result.
    if (!tool.handler) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_003,
        `Tool "${name}" has no handler registered`,
      );
    }

    try {
      this.logger.log(
        `Executing tool: ${name} with args: ${JSON.stringify(args).substring(0, 200)}`,
      );
      const result = await tool.handler(args, context);
      return result;
    } catch (error: any) {
      if (error instanceof VendixHttpException) throw error;
      this.logger.error(`Tool "${name}" execution failed: ${error.message}`);
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_003,
        `Tool "${name}" failed: ${error.message}`,
      );
    }
  }

  /**
   * Turns the rejection into the proposal.
   *
   * Called without a token, this computes the diff, mints a token bound to
   * (user, tool, arguments) and throws `AI_AGENT_005` carrying both. The agent
   * loop hands that error back to the model as a tool result, so the model
   * narrates the pending change and asks — no propose/confirm plumbing is
   * needed in any individual surface.
   *
   * Called with a token, it redeems it. Single use: a second attempt with the
   * same token fails, so a double-clicked "Aprobar" cannot apply twice.
   */
  private async enforceConfirmation(
    tool: RegisteredTool,
    name: string,
    args: Record<string, any>,
    context: ToolExecutionContext,
    confirmationToken?: string,
  ): Promise<void> {
    if (!confirmationToken) {
      const preview = tool.preview
        ? await tool.preview(args, context)
        : undefined;

      // A preview that already knows the change is impossible must not hand
      // out a token — approving it would only surface the same failure later.
      if (preview?.status === 'error') {
        throw new VendixHttpException(
          ErrorCodes.AI_AGENT_005,
          preview.message ?? `Tool "${name}" cannot be applied`,
          { tool: name, preview } as any,
        );
      }

      const token = await this.confirmations.issue(
        name,
        args,
        context.user_id,
      );

      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_005,
        `La herramienta "${name}" requiere confirmación del usuario antes de ejecutarse.`,
        {
          tool: name,
          arguments: args,
          preview,
          confirmation_token: token,
        } as any,
      );
    }

    const outcome = await this.confirmations.redeem(
      confirmationToken,
      name,
      args,
      context.user_id,
    );

    if (outcome === 'ok') return;

    throw new VendixHttpException(
      ErrorCodes.AI_AGENT_005,
      outcome === 'mismatch'
        ? `La confirmación no corresponde a estos cambios. Vuelve a proponer "${name}" y pide aprobación de nuevo.`
        : `La confirmación de "${name}" expiró o ya se usó. Vuelve a proponer el cambio.`,
      { tool: name, reason: outcome } as any,
    );
  }

  private toDefinition(tool: RegisteredTool): AIToolDefinition {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }
}
