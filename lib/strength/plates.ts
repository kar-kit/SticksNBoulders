/**
 * What can actually go on a bar.
 *
 * Arithmetic produces weights nobody can load: 73% of 182.5 is 133.225, and a
 * suggestion derived from an e1RM lands on a tenth of a kilo. Every number the
 * product puts in front of a lifter as "put this on the bar" comes through
 * here first.
 *
 * Lives in lib/strength because plate maths is a fact about barbells, not
 * about prescriptions -- it is needed by the RPE suggestion engine as well as
 * by the percentage resolver, and lib/programming depends on lib/strength
 * rather than the other way round.
 */

/**
 * The smallest jump a loaded barbell makes: a 1.25kg plate on each side.
 *
 * [Inference] Neither the ticket nor the blueprint specifies an increment;
 * 2.5kg is the standard plate pair. Micro-plates would make 1.25 defensible
 * instead. [SME to confirm] with Ruairi.
 */
export const LOADABLE_INCREMENT_KG = 2.5;

/**
 * Down, never up, and this is a product decision rather than arithmetic.
 *
 * The two directions are not equally wrong. Prescribing or suggesting more
 * than intended is a missed rep or a failed set; a shade less is a set that
 * was light. Rounding to nearest would also make 100% of a 191.5kg max resolve
 * to 192.5 -- a weight the athlete has never lifted, prescribed as if they had.
 *
 * The cost is that every derived weight sits up to 2.4kg under its exact
 * value, about 1% on a heavy squat. [SME to confirm] alongside the increment:
 * if Ruairi wants nearest, it is one word here.
 */
export const roundToLoadable = (kg: number): number =>
  Math.floor(kg / LOADABLE_INCREMENT_KG) * LOADABLE_INCREMENT_KG;
