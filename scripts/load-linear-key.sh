#!/usr/bin/env bash
# scripts/load-linear-key.sh
#
# Carga LINEAR_API_KEY desde el shell config del usuario sin tirar el
# .zshrc completo. Pensado para que CUALQUIER agente (Mavis, CI, otro
# script) pueda levantar la key con un solo comando, sin pegar el valor
# en chat y sin disparar la carga de Oh My Zsh / oh-my-posh (que escupe
# errores en subshells no-interactivos).
#
# Uso (cualquiera de las tres formas funciona):
#
#   source scripts/load-linear-key.sh
#   source /path/absoluto/a/Vendix/scripts/load-linear-key.sh
#   . scripts/load-linear-key.sh
#
# Después de sourcear, la variable $LINEAR_API_KEY queda disponible en
# el shell actual. Imprime un indicador de éxito con longitud y prefijo,
# nunca el valor.
#
# Si la key no está en ningún shell config, falla con exit 1 y un
# mensaje accionable.
#
# Por seguridad NUNCA imprime el valor de la key — solo los primeros 4
# caracteres para debug.

set -e

# Orden de búsqueda: de más común (mac/zsh) a más general (linux/bash).
SEARCH_PATHS=(
  "$HOME/.zshrc"
  "$HOME/.zshenv"
  "$HOME/.bashrc"
  "$HOME/.bash_profile"
  "$HOME/.profile"
  "/etc/profile.d/linear.sh"   # para setups CI / multi-tenant
)

found=0
for cfg in "${SEARCH_PATHS[@]}"; do
  if [ -f "$cfg" ]; then
    # Captura solo la primera línea que exporta LINEAR_API_KEY. Tolera
    # líneas comentadas o con espacios alrededor del `=`.
    line=$(grep -E '^[[:space:]]*export[[:space:]]+LINEAR_API_KEY=' "$cfg" 2>/dev/null | head -1)
    if [ -n "$line" ]; then
      # Eval en subshell para no contaminar el `set -e` si la key está
      # malformada — el caller verá el export abajo si todo va bien.
      if eval "$line" 2>/dev/null && [ -n "${LINEAR_API_KEY:-}" ]; then
        found=1
        break
      fi
    fi
  fi
done

if [ "$found" -eq 1 ]; then
  # Imprime longitud y prefijo, NUNCA el valor.
  prefix="${LINEAR_API_KEY:0:4}"
  echo "linear-key: loaded (len=${#LINEAR_API_KEY} prefix=${prefix}***) from $cfg"
  return 0 2>/dev/null || exit 0
else
  echo "linear-key: NOT FOUND in any shell config" >&2
  echo "" >&2
  echo "  Set it with ONE of these (in order of preference):" >&2
  echo "    1. macOS Keychain + ~/.zshrc wrapper:" >&2
  echo "       security add-generic-password -s linear-mavis -a \$USER -w 'lin_api_...'" >&2
  echo "       echo 'export LINEAR_API_KEY=\"\$(security find-generic-password -s linear-mavis -a \$USER -w)\"' >> ~/.zshrc" >&2
  echo "    2. 1Password / Bitwarden CLI + ~/.zshrc wrapper:" >&2
  echo "       echo 'export LINEAR_API_KEY=\"\$(op read \"op://Private/Linear/api_key\")\"' >> ~/.zshrc" >&2
  echo "    3. Directo (menos seguro):" >&2
  echo "       echo 'export LINEAR_API_KEY=\"lin_api_...\"' >> ~/.zshrc" >&2
  echo "       chmod 600 ~/.zshrc" >&2
  echo "" >&2
  echo "  Después: source ~/.zshrc o reiniciar terminal." >&2
  return 1 2>/dev/null || exit 1
fi
