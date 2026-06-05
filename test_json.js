const Database = require('better-sqlite3');
const db = new Database(':memory:');

console.log('=== JSON Function Tests ===');

// Test 1: json_valid with NULL
try {
  const result = db.prepare('SELECT json_valid(NULL) as v').get();
  console.log('1. json_valid(NULL):', result);
} catch (e) {
  console.log('1. json_valid(NULL) error:', e.message);
}

// Test 2: json_valid with invalid JSON string
try {
  const result = db.prepare('SELECT json_valid("not json") as v').get();
  console.log('2. json_valid("not json"):', result);
} catch (e) {
  console.log('2. json_valid("not json") error:', e.message);
}

// Test 3: json_valid with valid JSON
try {
  const result = db.prepare('SELECT json_valid("[1,2,3]") as v').get();
  console.log('3. json_valid("[1,2,3]"):', result);
} catch (e) {
  console.log('3. json_valid("[1,2,3]") error:', e.message);
}

// Test 4: json_each with NULL
try {
  const result = db.prepare('SELECT value FROM json_each(NULL)').all();
  console.log('4. json_each(NULL):', result);
} catch (e) {
  console.log('4. json_each(NULL) error:', e.message);
}

// Test 5: json_each with valid array
try {
  const result = db.prepare('SELECT value FROM json_each("[1,2,3]")').all();
  console.log('5. json_each("[1,2,3]"):', result);
} catch (e) {
  console.log('5. json_each("[1,2,3]") error:', e.message);
}

// Test 6: Condition with json_valid(NULL)
try {
  const result = db.prepare('SELECT 1 WHERE json_valid(NULL)').get();
  console.log('6. WHERE json_valid(NULL):', result);
} catch (e) {
  console.log('6. WHERE json_valid(NULL) error:', e.message);
}

// Test 7: Condition with json_valid with invalid JSON
try {
  const result = db.prepare('SELECT 1 WHERE json_valid("invalid")').get();
  console.log('7. WHERE json_valid("invalid"):', result);
} catch (e) {
  console.log('7. WHERE json_valid("invalid") error:', e.message);
}

// Test 8: EXISTS with json_each(NULL)
try {
  const result = db.prepare('SELECT 1 WHERE EXISTS (SELECT 1 FROM json_each(NULL))').get();
  console.log('8. WHERE EXISTS json_each(NULL):', result);
} catch (e) {
  console.log('8. WHERE EXISTS json_each(NULL) error:', e.message);
}

// Test 9: EXISTS with json_each valid
try {
  const result = db.prepare('SELECT 1 WHERE EXISTS (SELECT 1 FROM json_each("[1,2,3]"))').get();
  console.log('9. WHERE EXISTS json_each([1,2,3]):', result);
} catch (e) {
  console.log('9. WHERE EXISTS json_each([1,2,3]) error:', e.message);
}

// Test 10: Parameter binding with json_each
try {
  const stmt = db.prepare('SELECT value FROM json_each(?)');
  const result = stmt.all('[1,2,3]');
  console.log('10. json_each(?) with "[1,2,3]":', result);
} catch (e) {
  console.log('10. json_each(?) error:', e.message);
}

// Test 11: Full query simulation - manual album filter
try {
  db.exec(`
    CREATE TABLE images (
      id INTEGER,
      album_ids TEXT
    );
    INSERT INTO images VALUES (1, '[1,2,3]');
    INSERT INTO images VALUES (2, '[]');
    INSERT INTO images VALUES (3, NULL);
  `);
  
  const result = db.prepare(`
    SELECT id FROM images 
    WHERE album_ids IS NOT NULL 
      AND json_valid(album_ids) 
      AND EXISTS (SELECT 1 FROM json_each(images.album_ids) WHERE json_each.value = ?)
  `).all(1);
  console.log('11. Manual album filter (albumId=1):', result);
} catch (e) {
  console.log('11. Manual album filter error:', e.message);
}

