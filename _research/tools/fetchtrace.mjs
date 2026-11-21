const original = globalThis.fetch
globalThis.fetch = async (input, init) => {
  try {
    return await original(input, init)
  } catch (error) {
    console.log('[fetch-fail]', String(input).slice(0, 120), '|', error.message, '| cause:', error.cause && (error.cause.code || error.cause.message))
    throw error
  }
}
