let passwords = [];

export function generateOneTimePassword() {
  const words = [
    "apple",
    "banana",
    "cherry",
    "dog",
    "elephant",
    "fox",
    "grape",
    "hedgehog",
    "icecream",
    "jupiter",
  ];

  const selectedWords = Array.from(
    { length: 2 },
    () => words[Math.floor(Math.random() * words.length)]
  );

  const randomNumber = Math.floor(Math.random() * 101);
  const oneTimePassword = `${selectedWords.join("-")}-${randomNumber}`;

  passwords.push(oneTimePassword);

  return oneTimePassword;
}

export function useOneTimePassword(otp) {
  if (passwords.includes(otp)) {
    passwords = passwords.filter((password) => password !== otp);
    return true;
  }
  return false;
}
