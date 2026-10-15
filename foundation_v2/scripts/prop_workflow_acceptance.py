"""Prop creation/resume acceptance on disposable PostgreSQL and HTTP services."""
from offline_browser_acceptance import run_acceptance

if __name__ == '__main__':
    run_acceptance('prop-workflow-20261015', 'tests/propWorkflow.browser.mjs')
