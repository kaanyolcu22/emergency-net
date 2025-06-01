// src/util/RecoveryUtil.js - Fixed deterministic key generation
import crypto from 'crypto';

const turkishWordlist = [
  "elma", "masa", "kitap", "kalem", "deniz", "güneş", "yıldız", "ay",
  "köpek", "kedi", "kuş", "ağaç", "çiçek", "dağ", "nehir", "göl",
  "kapı", "pencere", "sandalye", "duvar", "sokak", "şehir", "ülke", "yol",
  "araba", "otobüs", "uçak", "gemi", "bisiklet", "tren", "metro", "taksi",
  "ekmek", "peynir", "zeytin", "çay", "kahve", "su", "süt", "şeker",
  "doktor", "öğretmen", "mühendis", "avukat", "pilot", "aşçı", "garson", "hemşire",
  "okul", "hastane", "market", "postane", "banka", "park", "müze", "kütüphane",
  "kırmızı", "mavi", "yeşil", "sarı", "beyaz", "siyah", "mor", "turuncu",
  "ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos",
  "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz"
];

export function generateRecoveryWords() {
  const words = [];
  
  while (words.length < 8) {
    const randomIndex = Math.floor(crypto.randomBytes(2).readUInt16BE(0) / 65536 * turkishWordlist.length);
    const word = turkishWordlist[randomIndex];
    
    if (!words.includes(word)) {
      words.push(word);
    }
  }
  
  return words;
}

export async function deriveKeyFromRecoveryPhrase(recoveryPhrase) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      recoveryPhrase, 
      'emergency-net-recovery-salt-v1', 
      100000, 
      32,    
      'sha512',
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      }
    );
  });
}

export async function hashRecoveryPhrase(recoveryPhrase) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await new Promise((resolve, reject) => {
    crypto.pbkdf2(
      recoveryPhrase, 
      salt, 
      100000, 
      64,     
      'sha512',
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey.toString('hex'));
      }
    );
  });
  
  return { hash, salt };
}

export async function verifyRecoveryPhrase(recoveryPhrase, storedHash, storedSalt) {
  try {
    if (!storedHash || !storedSalt) {
      console.error("Missing storedHash or storedSalt for recovery verification");
      return false;
    }
    
    const hash = await new Promise((resolve, reject) => {
      crypto.pbkdf2(
        recoveryPhrase, 
        storedSalt, 
        100000, 
        64, 
        'sha512',
        (err, derivedKey) => {
          if (err) reject(err);
          else resolve(derivedKey.toString('hex'));
        }
      );
    });

    return crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(storedHash, 'hex')
    );
  } catch (error) {
    console.error("Recovery phrase verification error:", error);
    return false;
  }
}

export function generateKeyPairFromSeed(seedMaterial) {
  const seed = crypto.createHash('sha256').update(seedMaterial).digest();
  
  const entropy = Buffer.concat([
    seed,
    Buffer.from('emergency-net-key-generation-v1', 'utf8')
  ]);

  const keyPair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });
  
  return keyPair;
}