async function callCatalog(env, path, method = "GET", payload = null, headers = {}) {
  const stub = catalogStub(env);
  if (!stub) return response({
    configured: false,
    error: { code: "channel_catalog_not_configured", message: "El catálogo todavía no está desplegado." }
  }, 503);
  const requestHeaders = new Headers(headers);
  if (payload !== null) requestHeaders.set("Content-Type", "application/json");
  const internalRequest = new Request("https://channel-catalog.internal" + path, {
    method,
    headers: requestHeaders,
    body: payload === null ? undefined : JSON.stringify(payload)
  });
  try {
    return await stub.fetch(internalRequest);
  } catch (error) {
    return response({
      error: {
        code: "channel_catalog_unavailable",
        message: "El catálogo de listas no respondió correctamente. Vuelve a intentarlo.",
        detail: cleanText(error && error.message || error, 180)
      }
    }, 503);
  }
}

/**
 * Autoriza el Chat con la misma identidad Google y el registro de licencias
 * que ya protege la APK completa. Solo licencias pagadas activas y el dueño
 * pueden leer o publicar. El pase gratuito habilita la APK, pero no el Chat.
 */
export async function authorizeChatAccess(request, env) {
  const identity = await googleIdentity(request, env);
  if (identity.error) return { error: identity.error };

  if (isAdmin(identity, env)) {
    return { identity, role: "admin" };
  }

  const licenseResponse = await callCatalog(
    env,
    "/licenses/check",
    "GET",
    null,
    { "X-License-Email": identity.email }
  );
  if (!licenseResponse.ok) return { error: licenseResponse };

  let license;
  try {
    license = await licenseResponse.json();
  } catch {
    return {
      error: response({
        error: {
          code: "license_check_unavailable",
          message: "No se pudo comprobar tu licencia. Inténtalo de nuevo."
        }
      }, 503)
    };
  }

  if (license.allowed !== true ||
      license.status !== "active" ||
      license.licenseType !== "paid") {
    return {
      error: response({
        error: {
          code: "paid_license_required",
          message: "El Chat es exclusivo para compradores con una licencia de pago activa de Deporte Total 360°."
        }
      }, 403)
    };
  }

  return { identity, role: "member" };
}

export async function handleChannelRoutes