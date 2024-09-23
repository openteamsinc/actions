*** Settings ***
Library           Process
Suite Teardown    Terminate All Processes    kill=True

*** Test Cases ***
Test PIP
    ${result} =    Run Process    env    shell=True    env:INPUT_PACKAGE-ECOSYSTEM=pip    env:INPUT_REQUIREMENTS-PATH=${CURDIR}/requirements.txt
    Log to console    ${result.stderr}
    Log to console    ${result.stdout}
    Should Be Equal As Integers    ${result.rc}    0
    Should Not Contain    ${result.stdout}    FAIL
    Should Contain    ${result.stdout}    Package flask

Test Conda
    ${result} =    Run Process    env    shell=True    env:INPUT_PACKAGE-ECOSYSTEM=conda
    Log to console    ${result.stderr}
    Log to console    ${result.stdout}
    Should Be Equal As Integers    ${result.rc}    1
    Should Contain    ${result.stdout}    Unsupported package ecosystem
