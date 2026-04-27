# Generic maintenance tasks

## After sprints

- Optimize modified LLM.md: Remember this file is to be read each time by agents, so it should be kept minimal and generic, specify caveats, tips & tricks, &c that are *specific* to the project they apply for and would take time to find out - so, let's avoid to copy here what is already in the jsdoc for example
- Optimize modified tests: Tests are extensively used and tests batteries are often run extensively. Even if they should be complete, they should be optimized not to overlap or purely have duplicates
- Tests also might have "intrinsic failure", async errors or stack overflow that haven't been solved as considered as secondary - at the end of the sprint, all should be green
- Lint+biome pass, we shouldn't discover red-ish VSCode behavior when opening a file