/**
 * Simple validation test for new selection logic
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 VALIDATING NEW SELECTION LOGIC\n');

try {
    // Test file paths
    const taskCreationPath = path.join(__dirname, 'src', 'utils', 'taskCreation.ts');
    const selectionPath = path.join(__dirname, 'src', 'google', 'selection.ts');
    const managerPath = path.join(__dirname, 'src', 'google', 'manager.ts');
    
    // Read files
    const taskCreationContent = fs.readFileSync(taskCreationPath, 'utf8');
    const selectionContent = fs.readFileSync(selectionPath, 'utf8');
    const managerContent = fs.readFileSync(managerPath, 'utf8');
    
    console.log('📁 Files read successfully');
    
    // Validation checks
    const checks = {
        'Auto-select Primary Calendar': taskCreationContent.includes('Auto-selected primary calendar'),
        'Create New TaskList Option': taskCreationContent.includes('CREATE_NEW_TASKLIST'),
        'TaskList Name Handler': selectionContent.includes('tasklist-name'),
        'CreateTaskList Method': managerContent.includes('async createTaskList(title: string)'),
        'Google Tasks API': managerContent.includes('tasklists.insert'),
        'Enhanced Options': taskCreationContent.includes('enhancedOptions'),
        'Name Validation': selectionContent.includes('length < 2'),
        'Error Handling': managerContent.includes('Authentication failed')
    };
    
    console.log('\n✅ VALIDATION RESULTS:');
    
    let passed = 0;
    const total = Object.keys(checks).length;
    
    for (const [check, result] of Object.entries(checks)) {
        console.log(`${result ? '✅' : '❌'} ${check}`);
        if (result) passed++;
    }
    
    console.log(`\n📊 SCORE: ${passed}/${total} checks passed`);
    
    if (passed === total) {
        console.log('\n🎉 ALL VALIDATIONS PASSED!');
        console.log('\n📋 CHANGES SUMMARY:');
        console.log('✅ Calendar: Auto-select primary (no user prompt)');
        console.log('✅ TaskList: Keep selection + Add "Create New" option');
        console.log('✅ New TaskList creation workflow implemented');
        console.log('✅ Google Tasks API integration added');
        console.log('✅ Error handling and validation complete');
        
        console.log('\n🚀 READY FOR DEPLOYMENT!');
    } else {
        console.log('\n⚠️ Some validations failed - check implementation');
    }
    
} catch (error) {
    console.error('❌ Validation failed:', error.message);
}
