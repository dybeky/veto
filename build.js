const { execSync } = require('child_process');
const fs = require('fs');

console.log('Building Veto...\n');

// Build TypeScript
console.log('1. Compiling TypeScript...');
try {
  execSync('npx tsc', { stdio: 'inherit' });
  console.log('✓ TypeScript compiled\n');
} catch (err) {
  console.error('✗ TypeScript compilation failed');
  process.exit(1);
}

// Create executable
console.log('2. Creating executable...');
try {
  // Ensure build directory exists
  if (!fs.existsSync('build')) {
    fs.mkdirSync('build');
  }

  // Build with pkg - create standalone executable with all dependencies
  execSync('npx pkg dist/index.js --targets node18-win-x64 --output build/veto.exe --config package.json', {
    stdio: 'inherit'
  });
  console.log('✓ Executable created\n');
} catch (err) {
  console.error('✗ Failed to create executable');
  console.error(err);
  process.exit(1);
}

// Add Windows metadata (icon and version info)
console.log('3. Adding Windows metadata...');
try {
  const ResEdit = require('resedit');
  const path = require('path');

  // Read the executable
  const exePath = path.join(__dirname, 'build', 'veto.exe');
  const exeData = fs.readFileSync(exePath);
  const exe = ResEdit.NtExecutable.from(exeData);
  const res = ResEdit.NtExecutableResource.from(exe);

  // Add icon if exists
  if (fs.existsSync('icon.ico')) {
    const iconData = fs.readFileSync('icon.ico');
    const iconFile = ResEdit.Data.IconFile.from(iconData);

    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      1, // Icon ID
      1033, // Language (English US)
      iconFile.icons.map(item => item.data)
    );
    console.log('  ✓ Icon added');
  }

  // Add version info
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];

  if (vi) {
    vi.removeStringValue({ lang: 1033, codepage: 1200 }, 'FileDescription');
    vi.removeStringValue({ lang: 1033, codepage: 1200 }, 'ProductName');
    vi.removeStringValue({ lang: 1033, codepage: 1200 }, 'CompanyName');
    vi.removeStringValue({ lang: 1033, codepage: 1200 }, 'OriginalFilename');
    vi.removeStringValue({ lang: 1033, codepage: 1200 }, 'InternalName');

    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      FileDescription: 'Veto - Discord Proxy Bypass',
      ProductName: 'Veto',
      CompanyName: '',
      LegalCopyright: 'MIT License',
      OriginalFilename: 'veto.exe',
      InternalName: 'veto',
      FileVersion: '2.0.0.0',
      ProductVersion: '2.0.0.0'
    });

    vi.setFileVersion(2, 0, 0, 0, 1033);
    vi.setProductVersion(2, 0, 0, 0, 1033);
    vi.outputToResourceEntries(res.entries);
    console.log('  ✓ Version info added');
  }

  // Apply all changes
  res.outputResource(exe);
  const newExeData = exe.generate();
  fs.writeFileSync(exePath, Buffer.from(newExeData));

  console.log('✓ Windows metadata added\n');
} catch (err) {
  console.log('⚠ Could not add Windows metadata (optional)');
  console.log('  Error:', err.message, '\n');
}

console.log('\n✅ Build complete!');
console.log('📦 Executable: build/veto.exe');
console.log('\nTo run: veto.exe start');
