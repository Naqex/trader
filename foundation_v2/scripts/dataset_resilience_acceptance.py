"""Fault injection touches only this fixture's disposable DB and artifact directory."""
from offline_browser_acceptance import run_acceptance

if __name__ == '__main__':
    run_acceptance('dataset-resilience-20261015', 'tests/datasetResilience.browser.mjs',
                   pytest_paths=('tests/test_local_dataset_removal.py', 'tests/test_dataset_recovery.py',
                                 'tests/test_ps02_replay_prop_connection.py'))
