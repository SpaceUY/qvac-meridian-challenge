/**
 * English number-to-words helpers shared by the speech rules. Pure
 * arithmetic, no dependencies - every rule that turns digits into words
 * goes through here, so a number always sounds the same wherever it shows up.
 */

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: ReadonlyArray<readonly [number, string]> = [
  [1_000_000_000_000, 'trillion'],
  [1_000_000_000, 'billion'],
  [1_000_000, 'million'],
  [1_000, 'thousand'],
];
/** Largest integer `integerToWords` can say ("nine hundred ninety-nine trillion …"). */
const MAX_SPOKEN_INTEGER = 999_999_999_999_999;
const ORDINAL_EXCEPTIONS: Record<string, string> = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth',
};

/** A written number: digits with optional thousands commas and decimals - "48", "1,100,000", "12.5". */
export const NUMERAL_PATTERN = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;

function underHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const tens = TENS[Math.floor(n / 10)]!;
  const ones = n % 10;
  return ones === 0 ? tens : `${tens}-${ONES[ones]}`;
}

function underThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return underHundred(rest);
  return rest === 0 ? `${ONES[hundreds]} hundred` : `${ONES[hundreds]} hundred ${underHundred(rest)}`;
}

/** 1100000 → "one million one hundred thousand". */
export function integerToWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_SPOKEN_INTEGER) {
    throw new RangeError(`integerToWords: ${n} is not an integer in 0..${MAX_SPOKEN_INTEGER}`);
  }
  if (n < 1000) return underThousand(n);
  const parts: string[] = [];
  let rest = n;
  for (const [value, name] of SCALES) {
    if (rest >= value) {
      parts.push(`${underThousand(Math.floor(rest / value))} ${name}`);
      rest %= value;
    }
  }
  if (rest > 0) parts.push(underThousand(rest));
  return parts.join(' ');
}

/** "88421" → "eight eight four two one": how an identifier is dictated. */
export function digitsToWords(digits: string): string {
  return [...digits].map((digit) => ONES[Number(digit)]).join(' ');
}

/**
 * "1,100,000" → "one million one hundred thousand", "12.50" → "twelve point
 * five". Digits after the point are read one by one, trailing zeros
 * dropped. An integer part too big to say as a quantity is dictated digit
 * by digit instead of throwing - rules run on free text, they must not fail.
 */
export function decimalToWords(numeral: string): string {
  const [integerPart = '', fractionPart = ''] = numeral.replace(/,/g, '').split('.');
  const integer = Number(integerPart);
  const integerWords = integer <= MAX_SPOKEN_INTEGER ? integerToWords(integer) : digitsToWords(integerPart);
  const fraction = fractionPart.replace(/0+$/, '');
  return fraction ? `${integerWords} point ${digitsToWords(fraction)}` : integerWords;
}

/** 12 → "twelfth", 29 → "twenty-ninth". */
export function ordinalToWords(n: number): string {
  return integerToWords(n).replace(
    /[a-z]+$/,
    (last) => ORDINAL_EXCEPTIONS[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`),
  );
}

/** 2026 → "twenty twenty-six", 2005 → "two thousand five", 1900 → "nineteen hundred". */
export function yearToWords(year: number): string {
  if (year < 1000 || year > 9999) return integerToWords(year);
  const century = Math.floor(year / 100);
  const rest = year % 100;
  if (rest === 0) return century % 10 === 0 ? integerToWords(year) : `${integerToWords(century)} hundred`;
  if (century % 10 === 0 && rest < 10) return integerToWords(year);
  return `${integerToWords(century)} ${rest < 10 ? `oh ${ONES[rest]}` : underHundred(rest)}`;
}
