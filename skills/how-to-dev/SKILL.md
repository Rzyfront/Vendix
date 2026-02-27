---
name: how-to-dev
description: >
  Establece el flujo obligatorio de desarrollo de software utilizando el sistema de skills.
  Trigger: SIEMPRE que el usuario solicite cambios, nuevas funcionalidades o desarrollo general.
license: MIT
metadata:
  author: vendix
  version: "1.0"
---

## When to Use

Esta skill debe regir **CADA** interacción de desarrollo en el repositorio Vendix. Es la guía maestra de cómo el agente de IA debe abordar las peticiones del usuario.

## Flujo de Desarrollo (Standard Changes)

Cuando el usuario solicita cambios específicos o mejoras:

1.  **Analizar la Petición**: Entender profundamente qué desea el usuario.
2.  **Búsqueda en el Routing de Skills**: Consultar `AGENTS.md` o el archivo de configuración del proveedor (`GEMINI.md`, `CLAUDE.md`) para encontrar skills relacionadas con el cambio.
3.  **Adquirir Contexto**: Leer las skills identificadas ANTES de realizar cualquier acción para asegurar que se sigan los patrones del proyecto.
4.  **Ejecutar con Contexto**: Realizar el cambio aplicando el conocimiento de las skills.
5.  **Manejo de Knowledge Gaps**: Si el cambio sigue un patrón nuevo no documentado, preguntar al usuario si se debe crear una nueva skill.

## Flujo de Desarrollo (Structural Changes / Plans)

Cuando la petición implica cambios estructurales, flujos completos, amplios, o un plan de desarrollo:

1.  **Pre-análisis**: Leer y realizar un pre-análisis de la petición que te da el usuario.
2.  **Análisis de Código**: Hacer un pequeño plan de análisis de código en base a la petición y luego planificarla.
3.  **Planificación por Etapas**: Analizar el plan en diversas etapas y puntos de desarrollo.
4.  **Búsqueda y Mapeo de Skills**: Ir al listado de skills (`AGENTS.md` o routing de skills) en busca de la información correcta basada en skills por etapa o punto de desarrollo. Debes terminar TODAS las skills sin falta que te puedan servir en cada etapa del plan, dejándolas específicamente resaltadas en el plan o desarrollo a continuación.
5.  **Ejecución Estricta**: En las fases de ejecución o desarrollo SIEMPRE se debe usar esta misma estrategia pre-diseñada basándose en los puntos y las skills del plan.
6.  **Cierre de Gap**: Al final, si alguna etapa del plan no contaba con una skill para seguir este patrón, entonces se diseña ese patrón y se le plantea al usuario la posibilidad de crear esta nueva skill para suplir un knowledge gap.

## 🚨 REGLAS ULTRA-OBLIGATORIAS

- **NUNCA** se debe crear o iniciar un plan sin referenciar detalladamente las skills requeridas por etapas y por puntos.
- **NUNCA, ABSOLUTAMENTE NUNCA** debes empezar el desarrollo de un plan que aún no tiene referencias a las skills en sus etapas o puntos. Siempre, *antes* de empezar a planificar o desarrollar, debes verificar qué skills cubren cada etapa o punto y referenciarlas correctamente en cada uno.
- **Siempre usar este estándar** pre-diseñado para todos los desarrollos.
- **Consultar antes de Actuar**: Nunca asumas un patrón ni avances sin mapear la skill pertinente frente a los puntos de cambio.

## Commands de Verificación

```bash
# Sincronizar skills después de crear/modificar una
./skills/setup.sh --sync

# Verificar logs de los contenedores para asegurar que el desarrollo no rompió el build
docker logs --tail 40 vendix_backend
docker logs --tail 40 vendix_frontend
```
