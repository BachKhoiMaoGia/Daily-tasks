/**
 * Simple validation test
 */
const db = require('better-sqlite3')('./tasks.db');

console.log('=== DATABASE SCHEMA VALIDATION ===\n');

// Check tasks table
console.log('TASKS TABLE:');
const tasksInfo = db.prepare('PRAGMA table_info(tasks)').all();
tasksInfo.forEach(col => {
    console.log(`  ${col.name}: ${col.type}`);
});

// Check deleted_tasks table  
console.log('\nDELETED_TASKS TABLE:');
const deletedInfo = db.prepare('PRAGMA table_info(deleted_tasks)').all();
deletedInfo.forEach(col => {
    console.log(`  ${col.name}: ${col.type}`);
});

// Check counts
console.log('\nCOUNTS:');
const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
const deletedCount = db.prepare('SELECT COUNT(*) as count FROM deleted_tasks').get().count;
console.log(`  Active tasks: ${taskCount}`);
console.log(`  Deleted tasks: ${deletedCount}`);

// Check task_type column exists
const hasTaskType = tasksInfo.some(col => col.name === 'task_type');
console.log(`  task_type column exists: ${hasTaskType ? 'YES' : 'NO'}`);

if (hasTaskType) {
    const taskTypes = db.prepare('SELECT task_type, COUNT(*) as count FROM tasks GROUP BY task_type').all();
    console.log('  Task type distribution:');
    taskTypes.forEach(type => {
        console.log(`    ${type.task_type || 'NULL'}: ${type.count}`);
    });
}

console.log('\n=== VALIDATION COMPLETE ===');
db.close();
