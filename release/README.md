# Release Packaging

Use this directory for generated student packages.

Generate the Windows student package from the project root:

```bash
npm run package:windows-student
```

Generated files are ignored by Git:

- `release/windows-student/`
- `release/windows-student.zip`
- `release/.cache/`

The committed source stays small, while the generated ZIP can be uploaded separately to a GitHub Release or distributed directly.
