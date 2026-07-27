const fs = require('fs');
const path = require('path');

// Test prepareRecordForDb from server.js logic
const serverCode = fs.readFileSync('server.js', 'utf8');

// Test packages schema
const testPkg = {
  id: 'pkg-123',
  package_code: 'ACC-12345',
  vendor_status: 'received',
  rejected_reason: 'out of stock',
  admin_status: 'on_delivery',
  vendor_amount: 150.00,
  commission_amount: 5.00,
  gross_amount: 155.00,
  buyer_confirmed: true,
  delivered_date: new Date().toISOString()
};

console.log('Testing packages schema update...');

// Extract TABLE_COLUMNS from server.js
const tableColsMatch = serverCode.match(/packages:\s*\[([^\]]+)\]/);
if (tableColsMatch) {
  const cols = tableColsMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
  console.log('Package Columns Count:', cols.length);
  
  const hasVendorStatus = cols.includes('vendor_status');
  const hasRejectedReason = cols.includes('rejected_reason');
  const hasAdminStatus = cols.includes('admin_status');
  const hasPackageCode = cols.includes('package_code');

  console.log('Includes vendor_status:', hasVendorStatus);
  console.log('Includes rejected_reason:', hasRejectedReason);
  console.log('Includes admin_status:', hasAdminStatus);
  console.log('Includes package_code:', hasPackageCode);

  if (hasVendorStatus && hasRejectedReason && hasAdminStatus && hasPackageCode) {
    console.log('PASSED: All critical order action columns are present in server.js schema!');
  } else {
    console.error('FAILED: Some columns are missing from server.js schema!');
  }
} else {
  console.error('FAILED: Could not find packages column definition in server.js!');
}
