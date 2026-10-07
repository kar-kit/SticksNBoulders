/**
 * How many clips `POST /api/clip` will mint URLs for in one request.
 *
 * Here rather than in the route because a Next route file may only export
 * handlers and route config, and the Review Queue has to batch to this number
 * rather than guess it. Anything that asks for more gets a 400 for the lot.
 *
 * A coach clearing a queue, not a script enumerating a bucket.
 */
export const MAX_FILES = 60;
